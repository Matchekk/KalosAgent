# Tesserack Red++

Browser-based autonomous training and local-LLM play for Pokemon Red++.

## Training model

Train mode uses a REINFORCE policy that chooses every required Game Boy action itself, including Start and party/battle menus. There is no scripted early-game controller.

Numeric learning signals come from one versioned, context-gated matrix:

- dialog: rewards actual page advancement and closing, with no generic step or stuck cost;
- overworld: rewards first-time exploration and penalizes blocked movement, revisits and short loops;
- battle: uses normalized HP fractions, type effectiveness, STAB and exact Red++ battle results;
- milestones: orders battle wins, party growth, badges and Champion on explicit scales;
- menus/saving: allows purposeful access but applies escalating penalties to repeated Start and save loops.

Run the deterministic quality benchmark with:

```bash
npm run benchmark:rewards --prefix app
```

## Red++ guide data

The canonical curriculum is [redpp-oak-guide.json](app/static/data/redpp-oak-guide.json), summarized from the user-supplied *Mewlax's Professor Oak Challenge Guide for Pokemon Red++*.

The supplied guide targets Red++ 4.5.3, while the configured ROM and WRAM mapping target Red++ 3.0.2. Guide facts are therefore advisory and observed v3.0.2 RAM is authoritative. Optional Professor Oak collection rules are retained as encounter/evolution knowledge but are not mandatory, because the active goal is to become Champion efficiently.

Guide data never defines numeric reinforcement rewards.

## Quick start

```bash
cd app
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/tesserack/`, load the Red++ ROM, then select Play or Train.

For the bundled local llama.cpp setup, use endpoint `http://localhost:8090/v1` and model `qwen3.5-0.8b`.

## Verification

```bash
npm test --prefix app
npm run build --prefix app
```

## License

MIT. Original Tesserack project by [Sid Mohan](https://github.com/sidmohan0).
