from fastapi import FastAPI, File, UploadFile, HTTPException
# from fastapi.middleware.httpsredirect import (
#     HTTPSRedirectMiddleware,
# )
from fastapi.responses import FileResponse, StreamingResponse
import boto3
import logging
from os import getpid
import os
from pathlib import Path
import tempfile
import subprocess
import threading
from dotenv import load_dotenv
import io
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger("uvicorn")


app = FastAPI(title="File Converter API")
# app.add_middleware(HTTPSRedirectMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize S3 client with credentials from .env
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION', 'us-east-1')
)
# Get bucket name from environment variable
BUCKET_NAME = os.getenv('AWS_BUCKET_NAME')

# Constants
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
ALLOWED_EXTENSIONS = {'.doc', '.docx'}

# Progress tracking
upload_progress = {}
conversion_progress = {}


class ProgressPercentage:
    def __init__(self, filename, filesize):
        self._filename = filename
        self._size = filesize
        self._seen_so_far = 0
        self._lock = threading.Lock()

    def __call__(self, bytes_amount):
        with self._lock:
            self._seen_so_far += bytes_amount
            percentage = (self._seen_so_far / self._size) * 100
            upload_progress[self._filename] = percentage


async def convert_to_pdf(filename: str):
    try:
        conversion_progress[filename] = 0

        # Create temporary directory for conversion
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, filename)
            conversion_progress[filename] = 10

            # Download file from S3
            response = s3_client.head_object(Bucket=BUCKET_NAME, Key=filename)
            file_size = response['ContentLength']
            progress = ProgressPercentage(filename, file_size)
            s3_client.download_file(
                BUCKET_NAME, filename, input_path, Callback=progress)
            conversion_progress[filename] = 30

            # Create output PDF filename
            output_filename = filename.rsplit('.', 1)[0] + '.pdf'
            output_path = os.path.join(temp_dir, output_filename)

            # Convert using LibreOffice
            process = subprocess.Popen([
                'soffice',  # Using libreoffice command explicitly
                '--headless',
                '--convert-to',
                'pdf',
                '--outdir',
                temp_dir,
                input_path
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            conversion_progress[filename] = 50

            # Wait for conversion to complete
            process.wait()
            conversion_progress[filename] = 70

            if process.returncode != 0:
                _, stderr = process.communicate()
                conversion_progress[filename] = -1  # Error state
                raise Exception(
                    f"LibreOffice conversion failed: {stderr.decode()}")

            # Upload converted PDF back to S3
            if os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                progress = ProgressPercentage(output_filename, file_size)
                s3_client.upload_file(
                    output_path,
                    BUCKET_NAME,
                    output_filename,
                    Callback=progress
                )
                conversion_progress[filename] = 100
            else:
                conversion_progress[filename] = -1  # Error state
                raise Exception("PDF file was not created")

        return output_filename
    except Exception as e:
        logger.error(f"Error converting file: {str(e)}")
        conversion_progress[filename] = -1  # Error state
        raise e


@app.get("/")
async def root():
    logger.info(f"Processed by worker process {getpid()}")
    return {"message": "Hello World"}


@app.post("/upload")
async def uploadFile(file: UploadFile = File(...)):
    try:
        # Validate file extension
        file_extension = Path(file.filename).suffix.lower()
        if file_extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="Only .doc or .docx files are allowed"
            )

        # Read file content
        file_content = await file.read()

        # Validate file size
        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="File size should not exceed 10MB"
            )

        # Initialize progress tracking
        upload_progress[file.filename] = 0

        # Upload to S3 with progress tracking
        progress = ProgressPercentage(file.filename, len(file_content))
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=file.filename,
            Body=file_content,
            ContentType=file.content_type,
        )

        # Convert file to PDF
        pdf_filename = await convert_to_pdf(file.filename)

        return {
            "message": "File uploaded and converted successfully",
            "original_filename": file.filename,
            "pdf_filename": pdf_filename,
            "content_type": file.content_type,
            "bucket": BUCKET_NAME
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error processing file: {str(e)}")
        return {"error": "Failed to process file"}


@app.get("/upload-progress/{filename}")
async def get_upload_progress(filename: str):
    if filename not in upload_progress:
        raise HTTPException(
            status_code=404,
            detail="No upload progress found for this file"
        )
    return {"filename": filename, "progress": upload_progress[filename]}


@app.get("/convert-progress/{filename}")
async def get_convert_progress(filename: str):
    if filename not in conversion_progress:
        raise HTTPException(
            status_code=404,
            detail="No conversion progress found for this file"
        )
    progress = conversion_progress[filename]
    status = "error" if progress == - \
        1 else "in_progress" if progress < 100 else "completed"
    return {
        "filename": filename,
        "progress": progress if progress != -1 else 0,
        "status": status
    }


def clear_files():
    try:
        # List all objects in the bucket
        objects = s3_client.list_objects_v2(Bucket=BUCKET_NAME)

        # Delete all objects
        if 'Contents' in objects:
            delete_keys = {'Objects': [{'Key': obj['Key']}
                                       for obj in objects['Contents']]}
            s3_client.delete_objects(Bucket=BUCKET_NAME, Delete=delete_keys)
            logger.info("All files cleared from bucket successfully")
    except Exception as e:
        logger.error(f"Error clearing files from bucket: {str(e)}")
        raise e


@app.get("/download/{filename}")
async def downloadFile(filename: str):
    try:
        # Get file from S3 into memory buffer
        file_obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
        file_content = file_obj['Body'].read()

        # Create an in-memory bytes buffer
        file_stream = io.BytesIO(file_content)

        # Clear all files after successful download
        clear_files()

        # Return streaming response that browser will handle as download
        return StreamingResponse(
            file_stream,
            media_type='application/pdf',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        logger.error(f"Error downloading file: {str(e)}")
        raise HTTPException(
            status_code=404,
            detail="File not found"
        )
