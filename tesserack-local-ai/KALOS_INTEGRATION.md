# Tesserack Local AI in KalosAgent

This directory is a self-contained snapshot of the improved Tesserack project.
It is intentionally isolated from the existing KalosAgent Python package.

## Local setup

1. Start an OpenAI-compatible `llama.cpp` server.
2. In Tesserack, select **llama.cpp (Local)** and use:
   - Endpoint URL: `http://localhost:8080/v1`
   - Model: `qwen3.5-0.8b`
   - API key: leave empty
3. Start the web app:

   ```powershell
   cd app
   npm install
   npm run dev
   ```

4. Open the shown local URL and load a legally obtained Pokemon Red-compatible
   `.gb` ROM through the file picker.

## Verification

Run the application checks from this directory:

```powershell
npm test --prefix app
npm run build --prefix app
```

## Repository hygiene

ROMs, save states, GGUF model weights, `llama.cpp` binaries, dependency folders,
generated builds, and runtime logs are excluded. They must stay local and must
not be committed to KalosAgent.

