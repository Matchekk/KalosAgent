// emulator.js - GameBoy emulator wrapper using binjgb
// Provides a clean API for loading ROMs, rendering, input, memory access, and state management

import { base } from '$app/paths';

// Track if binjgb script has been loaded
let binjgbLoaded = false;
let binjgbLoadPromise = null;

/**
 * Dynamically load binjgb.js script
 * @returns {Promise<void>}
 */
function loadBinjgbScript() {
    if (binjgbLoaded && typeof Binjgb !== 'undefined') {
        return Promise.resolve();
    }

    if (binjgbLoadPromise) {
        return binjgbLoadPromise;
    }

    binjgbLoadPromise = new Promise((resolve, reject) => {
        // Check if already loaded
        if (typeof Binjgb !== 'undefined') {
            binjgbLoaded = true;
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = `${base}/lib/binjgb.js`;
        script.onload = () => {
            binjgbLoaded = true;
            resolve();
        };
        script.onerror = () => {
            reject(new Error('Failed to load binjgb.js'));
        };
        document.head.appendChild(script);
    });

    return binjgbLoadPromise;
}

// Constants from binjgb
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const AUDIO_FRAMES = 4096;
const CPU_TICKS_PER_SECOND = 4194304;
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;
const MAX_UPDATE_SEC = 5 / 60;  // Max time to run emulator per step (5 frames)
const CGB_COLOR_CURVE = 2;      // Gambatte/Gameboy Online color curve

// Helper to create a view into WASM memory
function makeWasmBuffer(module, ptr, size) {
    return new Uint8Array(module.HEAP8.buffer, ptr, size);
}

export class Emulator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.module = null;
        this.e = null;  // Emulator pointer
        this.romDataPtr = null;
        this.running = false;
        this.frameCallback = null;
        this.rafCancelToken = null;
        this.lastRafSec = 0;
        this.leftoverTicks = 0;
        this.frameBuffer = null;
        this.imageData = null;
        this.joypadBufferPtr = null;

        // Button state tracking for press/release
        this.buttonState = {
            up: false, down: false, left: false, right: false,
            a: false, b: false, start: false, select: false
        };

        // Audio state
        this.audioCtx = null;
        this.audioBuffer = null;
        this.audioEnabled = false;
        this.audioVolume = 0.5;
        this.nextAudioTime = 0; // For scheduling audio buffers
    }

    /**
     * Initialize binjgb module. Must be called before loadROM.
     * @returns {Promise<boolean>}
     */
    async init() {
        // Dynamically load binjgb.js if not already loaded
        await loadBinjgbScript();

        if (typeof Binjgb === 'undefined') {
            throw new Error('binjgb not loaded. Script loaded but Binjgb function not found.');
        }

        // Initialize the WASM module
        this.module = await Binjgb();
        return true;
    }

    /**
     * Load a ROM into the emulator
     * @param {ArrayBuffer} romData - The ROM data as an ArrayBuffer
     * @returns {Promise<boolean>}
     */
    async loadROM(romData) {
        if (!this.module) {
            await this.init();
        }

        // Clean up any previous ROM
        if (this.e) {
            this.stop();
            this.module._emulator_delete(this.e);
            if (this.romDataPtr) {
                this.module._free(this.romDataPtr);
            }
        }

        // Align size up to 32k
        const size = (romData.byteLength + 0x7fff) & ~0x7fff;
        this.romDataPtr = this.module._malloc(size);

        // Copy ROM data to WASM memory
        const wasmRomBuffer = makeWasmBuffer(this.module, this.romDataPtr, size);
        wasmRomBuffer.fill(0);
        wasmRomBuffer.set(new Uint8Array(romData));

        // Create emulator instance
        // Note: Using 44100 sample rate and AUDIO_FRAMES as defaults
        this.e = this.module._emulator_new_simple(
            this.romDataPtr,
            size,
            44100,  // Sample rate
            AUDIO_FRAMES,
            CGB_COLOR_CURVE
        );

        if (this.e === 0) {
            throw new Error('Invalid ROM or failed to create emulator');
        }

        // Set up joypad
        this.joypadBufferPtr = this.module._joypad_new();
        this.module._emulator_set_default_joypad_callback(this.e, this.joypadBufferPtr);

        // Set up frame buffer access
        const frameBufferPtr = this.module._get_frame_buffer_ptr(this.e);
        const frameBufferSize = this.module._get_frame_buffer_size(this.e);
        this.frameBuffer = makeWasmBuffer(this.module, frameBufferPtr, frameBufferSize);

        // Set up rendering
        this.imageData = this.ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);

        // Set a nice default palette (palette 79 is a common choice)
        this.module._emulator_set_builtin_palette(this.e, 79);

        // Set up audio buffer access
        const audioBufferPtr = this.module._get_audio_buffer_ptr(this.e);
        const audioBufferCapacity = this.module._get_audio_buffer_capacity(this.e);
        this.audioBuffer = makeWasmBuffer(this.module, audioBufferPtr, audioBufferCapacity * 4); // 2 channels * 2 bytes per sample

        return true;
    }

    /**
     * Initialize Web Audio API
     * Must be called from a user gesture (click/keypress)
     */
    async initAudio() {
        if (this.audioCtx) return true;

        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100
            });

            // Create gain node for volume control
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = this.audioVolume;
            this.gainNode.connect(this.audioCtx.destination);

            // Resume if suspended (required by autoplay policy)
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }

            this.audioEnabled = true;
            console.log('Audio initialized');
            return true;
        } catch (e) {
            console.error('Failed to initialize audio:', e);
            return false;
        }
    }

    /**
     * Enable/disable audio
     */
    setAudioEnabled(enabled) {
        this.audioEnabled = enabled;
        if (this.audioCtx) {
            if (enabled) {
                this.audioCtx.resume();
                // Reset audio schedule when re-enabling
                this.nextAudioTime = this.audioCtx.currentTime;
            } else {
                this.audioCtx.suspend();
            }
        }
    }

    /**
     * Set audio volume (0.0 - 1.0)
     */
    setVolume(volume) {
        this.audioVolume = Math.max(0, Math.min(1, volume));
        if (this.gainNode) {
            this.gainNode.gain.value = this.audioVolume;
        }
    }

    /**
     * Play audio buffer with proper scheduling
     */
    playAudioBuffer() {
        if (!this.audioCtx || !this.audioEnabled || !this.audioBuffer) return;

        const currentTime = this.audioCtx.currentTime;

        // If we've fallen too far behind, reset the schedule
        // This happens when emulator runs faster than real-time
        if (this.nextAudioTime < currentTime) {
            this.nextAudioTime = currentTime;
        }

        // Don't queue too far ahead (max ~200ms buffer)
        // Skip this buffer if we're too far ahead
        if (this.nextAudioTime > currentTime + 0.2) {
            return;
        }

        // Create buffer for this chunk
        const buffer = this.audioCtx.createBuffer(2, AUDIO_FRAMES, 44100);
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);

        // Convert from interleaved i16 to float
        const view = new Int16Array(this.audioBuffer.buffer, this.audioBuffer.byteOffset, AUDIO_FRAMES * 2);
        for (let i = 0; i < AUDIO_FRAMES; i++) {
            left[i] = view[i * 2] / 32768;
            right[i] = view[i * 2 + 1] / 32768;
        }

        // Schedule to play at the next available time
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        source.start(this.nextAudioTime);

        // Advance the next play time by buffer duration
        this.nextAudioTime += buffer.duration;
    }

    /**
     * Start the emulation loop
     */
    start() {
        if (!this.e) {
            throw new Error('No ROM loaded');
        }
        this.running = true;
        this.lastRafSec = 0;
        this.leftoverTicks = 0;
        this.requestAnimationFrame();
    }

    /**
     * Stop the emulation loop
     */
    stop() {
        this.running = false;
        if (this.rafCancelToken !== null) {
            cancelAnimationFrame(this.rafCancelToken);
            this.rafCancelToken = null;
        }
    }

    /**
     * Request next animation frame
     */
    requestAnimationFrame() {
        this.rafCancelToken = requestAnimationFrame((ms) => this.loop(ms));
    }

    /**
     * Main emulation loop
     * @param {number} startMs - Timestamp from requestAnimationFrame
     */
    loop(startMs) {
        if (!this.running) return;

        const startSec = startMs / 1000;
        const deltaSec = Math.max(startSec - (this.lastRafSec || startSec), 0);

        // Calculate ticks to run
        const deltaTicks = Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND;
        const runUntilTicks = this.ticks + deltaTicks - this.leftoverTicks;

        // Run emulation
        this.runUntil(runUntilTicks);

        this.leftoverTicks = (this.ticks - runUntilTicks) | 0;
        this.lastRafSec = startSec;

        // Render frame
        this.render();

        // Notify callback
        if (this.frameCallback) {
            this.frameCallback();
        }

        // Schedule next frame
        this.requestAnimationFrame();
    }

    /**
     * Run emulation until specified ticks
     * @param {number} ticks - Target CPU ticks
     */
    runUntil(ticks) {
        while (true) {
            const event = this.module._emulator_run_until_f64(this.e, ticks);

            // Handle audio buffer full
            if (event & EVENT_AUDIO_BUFFER_FULL) {
                this.playAudioBuffer();
            }

            if (event & EVENT_UNTIL_TICKS) {
                break;
            }
        }
    }

    /**
     * Run a single frame of emulation
     */
    runFrame() {
        const targetTicks = this.ticks + CPU_TICKS_PER_SECOND / 60;
        this.runUntil(targetTicks);
    }

    /**
     * Get current CPU ticks
     * @returns {number}
     */
    get ticks() {
        return this.module._emulator_get_ticks_f64(this.e);
    }

    /**
     * Render current frame to canvas
     */
    render() {
        // Copy frame buffer to image data
        this.imageData.data.set(this.frameBuffer.subarray(0, SCREEN_WIDTH * SCREEN_HEIGHT * 4));
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /**
     * Get the current frame pixels as RGBA data
     * @returns {Uint8Array}
     */
    getPixels() {
        return new Uint8Array(this.frameBuffer.subarray(0, SCREEN_WIDTH * SCREEN_HEIGHT * 4));
    }

    /**
     * Press a button (and release after optional delay)
     * @param {string} button - Button name: 'a', 'b', 'start', 'select', 'up', 'down', 'left', 'right'
     * @param {number} duration - How long to hold in ms (0 for toggle, default 100)
     */
    pressButton(button, duration = 100) {
        this.setButton(button, true);
        if (duration > 0) {
            setTimeout(() => this.setButton(button, false), duration);
        }
    }

    /**
     * Set button state directly
     * @param {string} button - Button name
     * @param {boolean} pressed - Whether button is pressed
     */
    setButton(button, pressed) {
        const btn = button.toLowerCase();
        this.buttonState[btn] = pressed;

        switch (btn) {
            case 'up':
                this.module._set_joyp_up(this.e, pressed);
                break;
            case 'down':
                this.module._set_joyp_down(this.e, pressed);
                break;
            case 'left':
                this.module._set_joyp_left(this.e, pressed);
                break;
            case 'right':
                this.module._set_joyp_right(this.e, pressed);
                break;
            case 'a':
                this.module._set_joyp_A(this.e, pressed);
                break;
            case 'b':
                this.module._set_joyp_B(this.e, pressed);
                break;
            case 'start':
                this.module._set_joyp_start(this.e, pressed);
                break;
            case 'select':
                this.module._set_joyp_select(this.e, pressed);
                break;
            default:
                console.warn(`Unknown button: ${button}`);
        }
    }

    /**
     * Read a byte from memory
     * @param {number} address - Memory address (0x0000-0xFFFF)
     * @returns {number} - Byte value
     */
    readMemory(address) {
        return this.module._emulator_read_mem(this.e, address);
    }

    /**
     * Write a byte to memory
     * @param {number} address - Memory address
     * @param {number} value - Byte value
     */
    writeMemory(address, value) {
        this.module._emulator_write_mem(this.e, address, value);
    }

    /**
     * Read a range of memory addresses
     * @param {number} start - Start address
     * @param {number} length - Number of bytes
     * @returns {Uint8Array}
     */
    readMemoryRange(start, length) {
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            result[i] = this.readMemory(start + i);
        }
        return result;
    }

    /**
     * Get WRAM (Work RAM) pointer for direct access
     * @returns {Uint8Array}
     */
    getWRAM() {
        const ptr = this.module._emulator_get_wram_ptr(this.e);
        // WRAM is 8KB (0xC000-0xDFFF)
        return makeWasmBuffer(this.module, ptr, 8192);
    }

    /**
     * Get HRAM (High RAM) pointer for direct access
     * @returns {Uint8Array}
     */
    getHRAM() {
        const ptr = this.module._emulator_get_hram_ptr(this.e);
        // HRAM is 127 bytes (0xFF80-0xFFFE)
        return makeWasmBuffer(this.module, ptr, 127);
    }

    /**
     * Save emulator state
     * @returns {Uint8Array} - State data
     */
    saveState() {
        if (!this.e) {
            throw new Error('Emulator not initialized');
        }

        const fileDataPtr = this.module._state_file_data_new(this.e);
        if (!fileDataPtr) {
            throw new Error('Failed to create state file data');
        }

        const dataPtr = this.module._get_file_data_ptr(fileDataPtr);
        const dataSize = this.module._get_file_data_size(fileDataPtr);

        // Write state to the file data buffer
        this.module._emulator_write_state(this.e, fileDataPtr);

        // Copy the data (use slice() to ensure we get a true copy, not a view)
        const buffer = makeWasmBuffer(this.module, dataPtr, dataSize);
        const result = buffer.slice();

        // Clean up
        this.module._file_data_delete(fileDataPtr);

        return result;
    }

    /**
     * Load emulator state
     * @param {Uint8Array} state - State data from saveState()
     */
    loadState(state) {
        const fileDataPtr = this.module._state_file_data_new(this.e);
        const dataPtr = this.module._get_file_data_ptr(fileDataPtr);
        const dataSize = this.module._get_file_data_size(fileDataPtr);

        if (state.byteLength !== dataSize) {
            this.module._file_data_delete(fileDataPtr);
            throw new Error(`State size mismatch: expected ${dataSize}, got ${state.byteLength}`);
        }

        // Copy state data to the buffer
        const buffer = makeWasmBuffer(this.module, dataPtr, dataSize);
        buffer.set(state);

        // Read state from the file data buffer
        this.module._emulator_read_state(this.e, fileDataPtr);

        // Clean up
        this.module._file_data_delete(fileDataPtr);
    }

    /**
     * Save external RAM (cartridge save data)
     * @returns {Uint8Array} - ExtRAM data
     */
    saveExtRAM() {
        const fileDataPtr = this.module._ext_ram_file_data_new(this.e);
        const dataPtr = this.module._get_file_data_ptr(fileDataPtr);
        const dataSize = this.module._get_file_data_size(fileDataPtr);

        this.module._emulator_write_ext_ram(this.e, fileDataPtr);

        const buffer = makeWasmBuffer(this.module, dataPtr, dataSize);
        const result = new Uint8Array(buffer);

        this.module._file_data_delete(fileDataPtr);

        return result;
    }

    /**
     * Load external RAM (cartridge save data)
     * @param {Uint8Array} extram - ExtRAM data from saveExtRAM()
     */
    loadExtRAM(extram) {
        const fileDataPtr = this.module._ext_ram_file_data_new(this.e);
        const dataPtr = this.module._get_file_data_ptr(fileDataPtr);
        const dataSize = this.module._get_file_data_size(fileDataPtr);

        if (extram.byteLength !== dataSize) {
            this.module._file_data_delete(fileDataPtr);
            console.warn(`ExtRAM size mismatch: expected ${dataSize}, got ${extram.byteLength}`);
            return;
        }

        const buffer = makeWasmBuffer(this.module, dataPtr, dataSize);
        buffer.set(extram);

        this.module._emulator_read_ext_ram(this.e, fileDataPtr);
        this.module._file_data_delete(fileDataPtr);
    }

    /**
     * Set the color palette
     * @param {number} paletteIndex - Palette index (0-83)
     */
    setPalette(paletteIndex) {
        this.module._emulator_set_builtin_palette(this.e, paletteIndex);
    }

    /**
     * Get CPU registers for debugging
     * @returns {Object}
     */
    getRegisters() {
        return {
            PC: this.module._emulator_get_PC(this.e),
            SP: this.module._emulator_get_SP(this.e),
            A: this.module._emulator_get_A(this.e),
            F: this.module._emulator_get_F(this.e),
            BC: this.module._emulator_get_BC(this.e),
            DE: this.module._emulator_get_DE(this.e),
            HL: this.module._emulator_get_HL(this.e)
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stop();

        // Clean up audio
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
        }

        if (this.joypadBufferPtr) {
            this.module._joypad_delete(this.joypadBufferPtr);
            this.joypadBufferPtr = null;
        }

        if (this.e) {
            this.module._emulator_delete(this.e);
            this.e = null;
        }

        if (this.romDataPtr) {
            this.module._free(this.romDataPtr);
            this.romDataPtr = null;
        }
    }
}
