// @platform "node"
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { parseMidi, writeMidi, MidiData } from 'midi-file';
// @platform end

const execAsync = promisify(exec);

// SoundFont configuration
const SOUNDFONT_DIR = './soundfonts';
const SOUNDFONT_FILENAME = 'GeneralUser_GS_v1.471.sf2';
const SOUNDFONT_PATH = path.join(SOUNDFONT_DIR, SOUNDFONT_FILENAME);

// Download URL for GeneralUser GS SoundFont
// Using SourceForge direct download
const SOUNDFONT_URL = 'https://sourceforge.net/projects/androidframe/files/soundfonts/GeneralUser%20GS%20FluidSynth%20v1.44.sf2/download';

// General MIDI program numbers
const GRAND_PIANO_PROGRAM = 0;   // Acoustic Grand Piano
const ELECTRIC_PIANO_PROGRAM = 4; // Electric Piano 1 (Rhodes)

export type ConversionResult = {
    success: boolean;
    grandPianoPath?: string;
    electricPianoPath?: string;
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
 * Ensures the SoundFont is downloaded and available
 */
export const ensureSoundFontAvailable = async (): Promise<{ success: boolean; error?: string }> => {
    // Create soundfonts directory if it doesn't exist
    if (!fs.existsSync(SOUNDFONT_DIR)) {
        fs.mkdirSync(SOUNDFONT_DIR, { recursive: true });
    }

    // Check if SoundFont already exists
    if (fs.existsSync(SOUNDFONT_PATH)) {
        const stats = fs.statSync(SOUNDFONT_PATH);
        if (stats.size > 1000000) { // At least 1MB to be valid
            return { success: true };
        }
        // File exists but is too small, delete and re-download
        fs.unlinkSync(SOUNDFONT_PATH);
    }

    console.log('Downloading GeneralUser GS SoundFont...');

    try {
        await downloadFile(SOUNDFONT_URL, SOUNDFONT_PATH);
        console.log('SoundFont downloaded successfully');
        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Failed to download SoundFont: ${errorMessage}`,
        };
    }
};

/**
 * Downloads a file from a URL, following redirects
 */
const downloadFile = (url: string, destPath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        let redirectCount = 0;
        const maxRedirects = 10;

        const makeRequest = (requestUrl: string) => {
            const protocol = requestUrl.startsWith('https') ? https : require('node:http');

            protocol.get(requestUrl, (response: any) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    redirectCount++;
                    if (redirectCount > maxRedirects) {
                        file.close();
                        fs.unlinkSync(destPath);
                        reject(new Error('Too many redirects'));
                        return;
                    }
                    const redirectUrl = response.headers.location;
                    makeRequest(redirectUrl);
                    return;
                }

                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve();
                });

                file.on('error', (err: Error) => {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(err);
                });
            }).on('error', (err: Error) => {
                file.close();
                fs.unlinkSync(destPath);
                reject(err);
            });
        };

        makeRequest(url);
    });
};

/**
 * Creates a modified MIDI file with a program change at the beginning
 */
const createMidiWithProgram = (originalMidiPath: string, program: number, outputPath: string): void => {
    const midiBuffer = fs.readFileSync(originalMidiPath);
    const midiData = parseMidi(midiBuffer) as MidiData;

    // Insert program change at the beginning of the first track
    if (midiData.tracks.length > 0) {
        const programChangeEvent = {
            deltaTime: 0,
            type: 'programChange' as const,
            channel: 0,
            programNumber: program,
        };

        // Insert at the beginning of the track
        midiData.tracks[0].unshift(programChangeEvent);
    }

    const outputBuffer = Buffer.from(writeMidi(midiData));
    fs.writeFileSync(outputPath, outputBuffer);
};

/**
 * Converts a MIDI file to WAV audio using FluidSynth with a specific program
 */
const convertWithProgram = async (
    midiFilePath: string,
    program: number,
    outputSuffix: string
): Promise<{ success: boolean; audioPath?: string; error?: string }> => {
    const midiDir = path.dirname(midiFilePath);
    const midiBaseName = path.basename(midiFilePath, '.mid');

    // Create temporary MIDI file with program change
    const tempMidiPath = path.join(midiDir, `${midiBaseName}_temp_${program}.mid`);
    const audioFilePath = path.join(midiDir, `${midiBaseName}_${outputSuffix}.wav`);

    try {
        // Create modified MIDI with program change
        createMidiWithProgram(midiFilePath, program, tempMidiPath);

        // Build FluidSynth command
        const command = [
            'fluidsynth',
            '-n',
            '-i',
            '-g', '0.5',
            '-r', '44100',
            '-F', `"${audioFilePath}"`,
            `"${SOUNDFONT_PATH}"`,
            `"${tempMidiPath}"`,
        ].join(' ');

        await execAsync(command, { timeout: 120000 });

        // Clean up temp file
        if (fs.existsSync(tempMidiPath)) {
            fs.unlinkSync(tempMidiPath);
        }

        // Verify output file
        if (!fs.existsSync(audioFilePath)) {
            return { success: false, error: 'Audio file was not created' };
        }

        const stats = fs.statSync(audioFilePath);
        if (stats.size === 0) {
            fs.unlinkSync(audioFilePath);
            return { success: false, error: 'Audio file is empty' };
        }

        return { success: true, audioPath: audioFilePath };
    } catch (error) {
        // Clean up temp file on error
        if (fs.existsSync(tempMidiPath)) {
            try { fs.unlinkSync(tempMidiPath); } catch { /* ignore */ }
        }
        if (fs.existsSync(audioFilePath)) {
            try { fs.unlinkSync(audioFilePath); } catch { /* ignore */ }
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
    }
};

/**
 * Converts a MIDI file to two audio files: grand piano and electric piano
 */
export const convertMidiToAudio = async (midiFilePath: string): Promise<ConversionResult> => {
    // Ensure SoundFont is available
    const soundFontResult = await ensureSoundFontAvailable();
    if (!soundFontResult.success) {
        return {
            success: false,
            error: soundFontResult.error,
        };
    }

    // Validate MIDI file exists
    if (!fs.existsSync(midiFilePath)) {
        return {
            success: false,
            error: `MIDI file not found: ${midiFilePath}`,
        };
    }

    // Convert with grand piano
    console.log('Converting MIDI to grand piano audio...');
    const grandPianoResult = await convertWithProgram(midiFilePath, GRAND_PIANO_PROGRAM, 'grand_piano');

    // Convert with electric piano
    console.log('Converting MIDI to electric piano audio...');
    const electricPianoResult = await convertWithProgram(midiFilePath, ELECTRIC_PIANO_PROGRAM, 'electric_piano');

    // Return results
    if (!grandPianoResult.success && !electricPianoResult.success) {
        return {
            success: false,
            error: `Both conversions failed. Grand piano: ${grandPianoResult.error}. Electric piano: ${electricPianoResult.error}`,
        };
    }

    return {
        success: true,
        grandPianoPath: grandPianoResult.audioPath,
        electricPianoPath: electricPianoResult.audioPath,
    };
};
