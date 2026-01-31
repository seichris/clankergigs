#!/bin/bash

# Script to convert a multi-line private key to a single line for environment variables
# Usage: ./key-to-env.sh <input-file>

if [ $# -eq 0 ]; then
    echo "Usage: $0 <input-file>"
    echo "Example: $0 key.pem"
    exit 1
fi

INPUT_FILE="$1"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File '$INPUT_FILE' not found"
    exit 1
fi

# Convert the key to a single line by replacing newlines with \n
# Using awk to process line by line and join with literal \n
awk 'NF {if (NR > 1) printf "\\n"; printf "%s", $0}' "$INPUT_FILE"

# Add a newline at the end for readability
echo
