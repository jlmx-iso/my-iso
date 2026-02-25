#!/bin/bash
# Post-build script: patches handler.mjs to use CF Workers-native WASM import
# instead of Turbopack's incompatible WASM chunk loader.
#
# Run after: npx opennextjs-cloudflare build
# Run before: npx wrangler deploy

set -e

HANDLER=".open-next/server-functions/default/handler.mjs"
WASM_SRC=".open-next/server-functions/default/node_modules/.prisma/client/query_compiler_bg.wasm"
WASM_DEST=".open-next/server-functions/default/query_compiler_bg.wasm"

if [ ! -f "$HANDLER" ]; then
  echo "ERROR: $HANDLER not found. Run 'npx opennextjs-cloudflare build' first."
  exit 1
fi

if [ ! -f "$WASM_SRC" ]; then
  echo "ERROR: $WASM_SRC not found. Run 'npx opennextjs-cloudflare build' first."
  exit 1
fi

# 1. Copy WASM file next to handler.mjs
cp "$WASM_SRC" "$WASM_DEST"
echo "Copied WASM to $WASM_DEST"

# 2. Patch handler.mjs:
#    a) Add top-level WASM import (CF Workers pre-compiles this at deploy time)
#    b) Replace getQueryCompilerWasmModule to use the pre-imported module
python3 << 'PYEOF'
import re, sys

handler_path = ".open-next/server-functions/default/handler.mjs"

with open(handler_path, "r") as f:
    content = f.read()

# Add WASM import after the first import statement
first_import_end = content.index("\n") + 1
wasm_import = 'import __prismaQueryWasm from "./query_compiler_bg.wasm";\n'

old_fast_import = 'import __prismaQueryWasm from "./query_compiler_fast_bg.wasm";\n'
if wasm_import in content:
    print("Already patched with correct WASM import, skipping.")
elif old_fast_import in content:
    content = content.replace(old_fast_import, wasm_import)
    print("Replaced fast WASM import with bg WASM import.")
elif "__prismaQueryWasm" in content:
    print("Already patched, skipping import insertion.")
else:
    content = content[:first_import_end] + wasm_import + content[first_import_end:]
    print(f"Added WASM import at line 2")

# Replace all getQueryCompilerWasmModule functions
# Pattern varies by build — try multiple known patterns
patterns = [
    # Turbopack chunk loader pattern: getQueryCompilerWasmModule:async()=>{let{default:X}=await Y.A(ID);return X}
    r'getQueryCompilerWasmModule:async\(\)=>\{let\{default:\w+\}=await \w+\.A\(\d+\);return \w+\}',
    # wasm_worker_loader pattern: matches both "last prop" (ends with }) and "not last prop" (ends with ,)
    # The trailing } or , is NOT consumed by this pattern, so the replacement doesn't need to restore it.
    r'getQueryCompilerWasmModule:async\(\)=>\(await\(await Promise\.resolve\(\)\.then\(\(\)=>\(init_wasm_worker_loader\(\),wasm_worker_loader_exports\)\)\)\.default\)\.default',
]
replacement = 'getQueryCompilerWasmModule:async()=>__prismaQueryWasm'

total = 0
for pattern in patterns:
    count = len(re.findall(pattern, content))
    if count > 0:
        content = re.sub(pattern, replacement, content)
        print(f"Patched {count} instance(s) using pattern: {pattern[:60]}...")
        total += count

if total == 0:
    # Check if already patched
    if 'getQueryCompilerWasmModule:async()=>__prismaQueryWasm' in content:
        print("Already patched, skipping replacement.")
    else:
        print("WARNING: No getQueryCompilerWasmModule patterns found to patch!")
        # Show what's actually in the file for debugging
        for m in re.finditer(r'getQueryCompilerWasmModule.{0,150}', content):
            print(f"  Found at {m.start()}: {repr(m.group()[:120])}")
        sys.exit(1)

print(f"Patched {total} getQueryCompilerWasmModule function(s) total")

with open(handler_path, "w") as f:
    f.write(content)

print("Done! handler.mjs patched successfully.")
PYEOF

echo "Prisma WASM patch complete."
