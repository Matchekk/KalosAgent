# Tesserack Red++

Browser-based autonomous training and local-LLM play for Pokemon Red++.

## Training model

Train mode uses a browser-native PPO/GAE actor-critic that chooses every required Game Boy action itself, including Start and party/battle menus. Four synchronized environments combine a learned value baseline, episodic novelty and an autonomous frontier archive; there is no scripted controller.

Training runs four independent Red++ emulator environments against one shared on-policy learner. The visible environment and two headless environments resume from the strongest RAM-verified checkpoint; a fourth environment always starts from the original ROM state so the policy cannot forget the opening. Checkpoints are ranked by durable progress (Champion, badges, Oak rival, party, route, team quality, levels) and never by noisy short-term reward. Only one emulator is rendered, and the aggregate 512-sample rollout keeps discounted returns isolated per environment.

Numeric learning signals come from one versioned, context-gated matrix:

- dialog: rewards actual page advancement and closing, with no generic step or stuck cost; credit diminishes geometrically and is capped at 0.2 per world position, so even an arbitrarily long conversation stays below one level-up;
- overworld: rewards first-time exploration and penalizes blocked movement, revisits and short loops;
- battle: uses normalized HP fractions, type effectiveness, STAB and exact Red++ battle results;
- team building: rewards every first-time roster slot and one full-team milestone, then scores level balance, distinct typings, damaging-move coverage, stacked weaknesses and the exact Red++ v3 base-stat totals;
- milestones: orders battle wins, team growth, badges and Champion on explicit scales;
- menus/saving: allows purposeful access but applies escalating penalties to repeated Start and save loops.

Team quality is normalized to 0..1 and contributes six policy inputs. Positive quality shaping uses an episode high watermark, so swapping a strong team out and back in cannot farm reward. All six roster rewards, the full-team bonus, and the maximum possible quality shaping together remain smaller than one badge; a single quality transition is capped below a wild-battle win.

The semantic scale is strict: tile (0.04) < new map (0.5) < level (0.75) < new team member (1.5) < wild win (2.5) < trainer win (6) < badge (20) < Champion (150). A full HP-bar battle transition is normalized and capped below a win; losses, whiteouts, menu spam, and repeated saves use increasing negative severity according to their gameplay consequence.

The Train toolbar supports up to 16x pacing and reports aggregate samples per second. Run both deterministic quality benchmarks with:

```bash
npm run benchmark:rewards --prefix app
npm run benchmark:parallel --prefix app
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

Open `http://127.0.0.1:4173/`, load the Red++ ROM, then select Play or Train.

For the bundled local llama.cpp setup, use endpoint `http://localhost:8090/v1` and model `qwen3.5-0.8b`.

## Verification

```bash
npm test --prefix app
npm run build --prefix app
```

## License

MIT. Original Tesserack project by [Sid Mohan](https://github.com/sidmohan0).
