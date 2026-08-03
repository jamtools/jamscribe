import type {AudioDeviceInfo, AudioRecordingConfig} from './audio_types';

export const getStableAudioDeviceLabel = (label: string): string => {
    return label
        .replace(/\s+·\s+hardware\s+hw:\d+,\d+\s*$/i, '')
        .replace(/\s+\((?:plug)?hw:\d+,\d+\)\s*$/i, '')
        .trim();
};

export const rebindAudioConfigToAvailableDevice = (
    config: AudioRecordingConfig,
    devices: AudioDeviceInfo[],
): AudioRecordingConfig => {
    if (config.deviceId === 'default') {
        return config;
    }

    const exactMatch = devices.find(device => device.id === config.deviceId);
    if (exactMatch) {
        return {
            ...config,
            deviceLabel: exactMatch.label,
        };
    }

    const stableSelectedLabel = getStableAudioDeviceLabel(config.deviceLabel || config.deviceId);
    const stableMatch = devices.find(device => getStableAudioDeviceLabel(device.label) === stableSelectedLabel);
    if (!stableMatch) {
        return config;
    }

    return {
        ...config,
        deviceId: stableMatch.id,
        deviceLabel: stableMatch.label,
    };
};

export const getAudioDevicesForDisplay = (
    devices: AudioDeviceInfo[],
    selectedConfig: AudioRecordingConfig,
): AudioDeviceInfo[] => {
    if (devices.length > 0) {
        return devices;
    }

    if (selectedConfig.deviceId === 'default') {
        return [];
    }

    return [{
        id: selectedConfig.deviceId,
        label: selectedConfig.deviceLabel || selectedConfig.deviceId,
    }];
};
