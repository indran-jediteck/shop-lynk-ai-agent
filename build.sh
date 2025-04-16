#!/bin/bash

# Exit on error
set -e

echo "Starting build process..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Verify build output
echo "Verifying build output..."
if [ ! -d "dist" ]; then
    echo "Error: dist directory not found after build"
    echo "Current directory contents:"
    ls -la
    exit 1
fi

# Install production dependencies
echo "Installing production dependencies..."
npm install --production

# Make server.js executable
if [ -f "dist/server.js" ]; then
    chmod +x dist/server.js
    echo "Build completed successfully!"
else
    echo "Error: server.js not found in dist directory"
    echo "Contents of dist directory:"
    ls -la dist
    exit 1
fi 