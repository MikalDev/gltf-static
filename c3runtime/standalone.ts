"use strict";

// Create only once
if (!(globalThis as any)._initTrapSet) {
    (globalThis as any)._initTrapSet = true;
    Object.defineProperty(globalThis, "C3_SetInitFunctions", {
        configurable: true,
        set(_fn: (e: unknown, t: unknown) => void) {
            // Replace the property with a wrapped version
            Object.defineProperty(globalThis, "C3_SetInitFunctions", {
                configurable: true,
                writable: true,
                value: (e: unknown, t: (...args: unknown[]) => unknown) => {
                    (globalThis as any).captured_t = t;
                    // Wrap t to capture the runtime it returns
                    const wrappedT = (...args: unknown[]) => {
                        const runtime = t(...args);
                        (globalThis as any).badlandsRuntime = runtime;
                        return runtime;
                    };
                    return _fn(e, wrappedT);
                }
            });
        }
    });
}

