// @platform "node"
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
// @platform end

const execAsync = promisify(exec);

export type FluidSynthConfig = {
    soundFontPath: string;
    sampleRate?: number;
    gain?: number;
};

export type ConversionResult = {
    success: boolean;
    audioFilePath?: string;
    error?: string;
};

/**
 * Checks if FluidSynth is installed and available in PATH
 */
export const isFluidSynthAvailable = async (): Promise<boolean> => {
    try {
        await execAsync('fluidsynth --version');
        return true;
    } catch {
        return false;
    }
};

/**
 * Converts a MIDI file to WAV audio using FluidSynth
 *
 * @param midiFilePath - Path to the input MIDI file
 * @param config - FluidSynth configuration options
 * @returns ConversionResult with the path to the generated audio file
 */
export const convertMidiToAudio = async (
    midiFilePath: string,
    config: FluidSynthConfig
): Promise<ConversionResult> => {
    const { soundFontPath, sampleRate = 44100, gain = 0.5 } = config;

    // Validate SoundFont path
    if (!soundFontPath) {
        return {
            success: false,
            error: 'No SoundFont path configured',
        };
    }

    if (!fs.existsSync(soundFontPath)) {
        return {
            success: false,
            error: `SoundFont file not found: ${soundFontPath}`,
        };
    }

    // Validate MIDI file exists
    if (!fs.existsSync(midiFilePath)) {
        return {
            success: false,
            error: `MIDI file not found: ${midiFilePath}`,
        };
    }

    // Generate output audio file path (same name as MIDI but with .wav extension)
    const midiDir = path.dirname(midiFilePath);
    const midiBaseName = path.basename(midiFilePath, '.mid');
    const audioFilePath = path.join(midiDir, `${midiBaseName}.wav`);

    // Build FluidSynth command
    // -n: No MIDI input
    // -i: Non-interactive mode (quit after rendering)
    // -F: Fast render to file
    // -r: Sample rate
    // -g: Gain (0.0 to 10.0)
    const command = [
        'fluidsynth',
        '-n',
        '-i',
        '-g', gain.toString(),
        '-r', sampleRate.toString(),
        '-F', `"${audioFilePath}"`,
        `"${soundFontPath}"`,
        `"${midiFilePath}"`,
    ].join(' ');

    try {
        const { stderr } = await execAsync(command, {
            timeout: 60000, // 60 second timeout
        });

        // FluidSynth may output warnings to stderr even on success
        // Check if the output file was created
        if (!fs.existsSync(audioFilePath)) {
            return {
                success: false,
                error: `Audio file was not created. FluidSynth output: ${stderr}`,
            };
        }

        // Verify the file has content
        const stats = fs.statSync(audioFilePath);
        if (stats.size === 0) {
            fs.unlinkSync(audioFilePath); // Clean up empty file
            return {
                success: false,
                error: 'FluidSynth created an empty audio file',
            };
        }

        return {
            success: true,
            audioFilePath,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Clean up partial file if it exists
        if (fs.existsSync(audioFilePath)) {
            try {
                fs.unlinkSync(audioFilePath);
            } catch {
                // Ignore cleanup errors
            }
        }

        return {
            success: false,
            error: `FluidSynth conversion failed: ${errorMessage}`,
        };
    }
};

/**
 * Gets the audio file path for a given MIDI file path
 */
export const getAudioFilePathForMidi = (midiFilePath: string): string => {
    const midiDir = path.dirname(midiFilePath);
    const midiBaseName = path.basename(midiFilePath, '.mid');
    return path.join(midiDir, `${midiBaseName}.wav`);
};
