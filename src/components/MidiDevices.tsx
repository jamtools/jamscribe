import React from 'react';
import '@jamtools/core/modules/io/io_module';
import {useModule} from '../hooks/use_module';

export const MidiDevices: React.FC = () => {
    const ioModule = useModule('io');
    const midiDevices = ioModule.midiDeviceState.useState().midiInputDevices;

    return (
        <div className="card midi-devices-card">
            <div className="card-header">
                <h2 className="card-title">🎹 MIDI Input Devices</h2>
            </div>
            {midiDevices && midiDevices.length > 0 ? (
                <ul className="device-list">
                    {midiDevices.map((device, index) => (
                        <li key={index} className="device-item fade-in">
                            <span className="device-icon">🎹</span>
                            <span className="device-name">{device}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">🎹</div>
                    <p className="text-muted mb-0">No MIDI input devices connected</p>
                    <p className="text-muted">Connect a MIDI device to start recording</p>
                </div>
            )}
        </div>
    );
};
