import os
import time
import boto3
from botocore.exceptions import ClientError

BUCKET = 'aksg-media'


def client():
    return boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT'],
                        aws_access_key_id=os.environ['S3_ACCESS_KEY'],
                        aws_secret_access_key=os.environ['S3_SECRET_KEY'], region_name='us-east-1')


def prepare():
    for attempt in range(30):
        try:
            s3 = client()
            try:
                s3.head_bucket(Bucket=BUCKET)
            except ClientError:
                s3.create_bucket(Bucket=BUCKET)
            return
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
