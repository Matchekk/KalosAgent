// Theme store - manages dark/light mode
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Get initial theme from localStorage or system preference
function getInitialTheme() {
    if (!browser) return 'light';

    const stored = localStorage.getItem('tesserack-theme');
    if (stored === 'dark' || stored === 'light') {
        return stored;
    }

    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }

    return 'light';
}

function createThemeStore() {
    const { subscribe, set, update } = writable(getInitialTheme());

    return {
        subscribe,
        toggle: () => {
            update(current => {
                const next = current === 'dark' ? 'light' : 'dark';
                if (browser) {
                    localStorage.setItem('tesserack-theme', next);
                    document.documentElement.setAttribute('data-theme', next);
                }
                return next;
            });
        },
        set: (theme) => {
            if (browser) {
                localStorage.setItem('tesserack-theme', theme);
                document.documentElement.setAttribute('data-theme', theme);
            }
            set(theme);
        },
        init: () => {
            if (browser) {
                const theme = getInitialTheme();
                document.documentElement.setAttribute('data-theme', theme);
                set(theme);
            }
        }
    };
}

export const theme = createThemeStore();
