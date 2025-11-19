// @platform "node"
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
// @platform end

const PART_SIZE = 5 * 1024 * 1024;

function computeSha1(buffer: Buffer): string {
    const hash = crypto.createHash('sha1');
    hash.update(buffer);
    return hash.digest('hex');
}

type UploadInfo = {
    project_name: string;
    workspace_name: string;
    endpoints: {
        initiate_upload: string;
        part_url: string;
        complete_upload: string;
        abort_upload: string;
    };
};

type InitiateData = {
    upload_id: string;
    file_path: string;
    upload_record_id: string;
    part_url_endpoint: string;
    complete_url: string;
    abort_url: string;
};

export const uploadFile = async (fileName: string, contentType: string, buffer: Buffer, uploaderUrl: string): Promise<void> => {
    return uploadFileInternal(fileName, contentType, buffer, uploaderUrl);
};

export const uploadFileFromPath = async (fileName: string, contentType: string, filePath: string, uploaderUrl: string): Promise<void> => {
    const buffer = await fs.promises.readFile(filePath);
    return uploadFileInternal(fileName, contentType, buffer, uploaderUrl);
};

const uploadFileInternal = async (fileName: string, contentType: string, buffer: Buffer, uploaderUrl: string): Promise<void> => {
    try {
        if (!uploaderUrl) {
            console.log('No uploader URL configured, skipping upload');
            return;
        }

        const infoResponse = await fetch(uploaderUrl);

        if (!infoResponse.ok) {
            const errorText = await infoResponse.text();
            throw new Error(`Failed to get upload info: ${infoResponse.status} ${infoResponse.statusText}\n${errorText}`);
        }

        const uploadInfo = await infoResponse.json() as UploadInfo;

        const fileSize = buffer.length;
        const partCount = Math.ceil(fileSize / PART_SIZE);
        const fileHash = computeSha1(buffer);

        const initiateResponse = await fetch(uploadInfo.endpoints.initiate_upload, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                file_name: fileName,
                content_type: contentType,
                part_count: partCount,
            }),
        });

        if (!initiateResponse.ok) {
            const errorText = await initiateResponse.text();
            throw new Error(`Failed to initiate upload: ${initiateResponse.status} ${initiateResponse.statusText}\n${errorText}`);
        }

        const initiateData = await initiateResponse.json() as InitiateData;

        const uploadedParts: Array<{ETag: string; PartNumber: number}> = [];

        for (let partNumber = 1; partNumber <= partCount; partNumber++) {
            const start = (partNumber - 1) * PART_SIZE;
            const end = Math.min(start + PART_SIZE, fileSize);
            const partBuffer = buffer.slice(start, end);

            const partUrlResponse = await fetch(uploadInfo.endpoints.part_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    upload_id: initiateData.upload_id,
                    file_path: initiateData.file_path,
                    part_number: partNumber,
                    content_type: contentType,
                }),
            });

            if (!partUrlResponse.ok) {
                const errorText = await partUrlResponse.text();
                throw new Error(`Failed to get part URL: ${partUrlResponse.status} ${partUrlResponse.statusText}\n${errorText}`);
            }

            const partUrlData = await partUrlResponse.json() as {
                part_number: number;
                upload_url: string;
            };

            const uploadPartResponse = await fetch(partUrlData.upload_url, {
                method: 'PUT',
                body: partBuffer,
                headers: {
                    'Content-Type': contentType,
                },
            });

            if (!uploadPartResponse.ok) {
                const errorText = await uploadPartResponse.text();
                throw new Error(`Failed to upload part ${partNumber}: ${uploadPartResponse.status} ${uploadPartResponse.statusText}\n${errorText}`);
            }

            const etag = uploadPartResponse.headers.get('ETag');
            if (!etag) {
                throw new Error(`No ETag returned for part ${partNumber}`);
            }

            uploadedParts.push({
                ETag: etag.replace(/"/g, ''),
                PartNumber: partNumber,
            });
        }

        const completeResponse = await fetch(uploadInfo.endpoints.complete_upload, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                upload_id: initiateData.upload_id,
                file_path: initiateData.file_path,
                upload_record_id: initiateData.upload_record_id,
                parts: uploadedParts,
                file_size: fileSize,
                file_hash: fileHash,
            }),
        });

        if (!completeResponse.ok) {
            const errorText = await completeResponse.text();
            throw new Error(`Failed to complete upload: ${completeResponse.status} ${completeResponse.statusText}\n${errorText}`);
        }
    } catch (error) {
        console.error('Error during multipart upload:', error);
        throw error;
    }
};
