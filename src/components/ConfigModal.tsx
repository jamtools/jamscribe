import React, { useRef, useEffect } from 'react';
import { RecordingConfig } from '../services/recorder';

type ConfigModalProps = {
    isOpen: boolean;
    onClose: () => void;
    recordingConfig: RecordingConfig;
    draftInactivityTimeLimit: number;
    onDraftInactivityTimeLimitChange: (newLimit: number) => void;
    submitInactivityTimeLimitChange: () => void;
    draftUploaderUrl: string;
    onDraftUploaderUrlChange: (newUrl: string) => void;
    submitUploaderUrlChange: () => void;
};

export function asModal<P extends { isOpen: boolean; onClose: () => void }>(
    Component: React.ComponentType<P>
) {
    return (props: P) => {
        const dialogRef = useRef<HTMLDialogElement>(null);

        useEffect(() => {
            const dialog = dialogRef.current;
            if (!dialog) return;

            if (props.isOpen) {
                dialog.showModal();
            } else {
                dialog.close();
            }
        }, [props.isOpen]);

        const handleClose = () => {
            props.onClose();
        };

        return (
            <dialog ref={dialogRef} onClose={handleClose}>
                <Component {...props} />
            </dialog>
        );
    };
}

function ConfigModalBase({
    onClose,
    recordingConfig,
    draftInactivityTimeLimit,
    onDraftInactivityTimeLimitChange,
    submitInactivityTimeLimitChange,
    draftUploaderUrl,
    onDraftUploaderUrlChange,
    submitUploaderUrlChange,
}: ConfigModalProps) {
    return (
        <div>
            <div className="modal-header">
                <h2 className="modal-title">⚙️ Recording Settings</h2>
            </div>
            <div className="modal-body">
                <div className="form-group">
                    <label className="form-label" htmlFor="inactivity-limit">
                        Inactivity Time Limit (seconds)
                    </label>
                    <input
                        id="inactivity-limit"
                        type='number'
                        className='form-input'
                        value={draftInactivityTimeLimit}
                        onChange={(e) => onDraftInactivityTimeLimitChange(parseInt(e.target.value))}
                        min={1}
                        max={300}
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        Recording will automatically stop after this many seconds of inactivity
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label" htmlFor="uploader-url">
                        Uploader URL
                    </label>
                    <input
                        id="uploader-url"
                        type='text'
                        className='form-input'
                        value={draftUploaderUrl}
                        onChange={(e) => onDraftUploaderUrlChange(e.target.value)}
                        placeholder="https://example.com/upload"
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        URL endpoint for uploading recorded files (leave empty to disable uploads)
                    </p>
                </div>
            </div>
            <div className="modal-footer">
                <button
                    type='button'
                    className='btn-secondary'
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    type='button'
                    className='btn-primary'
                    onClick={() => {
                        submitInactivityTimeLimitChange();
                        submitUploaderUrlChange();
                        onClose();
                    }}
                >
                    Save Changes
                </button>
            </div>
        </div>
    );
}

export const ConfigModal = asModal(ConfigModalBase);
