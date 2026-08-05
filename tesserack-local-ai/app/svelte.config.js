import adapter from '@sveltejs/adapter-static';

const dev = process.argv.includes('dev');
const isVercel = process.env.VERCEL === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: {
			// Use /tesserack base path for GitHub Pages, empty for Vercel/local dev
			base: dev || isVercel ? '' : '/tesserack'
		}
	}
};

export default config;
