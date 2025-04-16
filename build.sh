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

# Create necessary directories
echo "Creating directories..."
mkdir -p dist
mkdir -p /opt/render/project/src/dist

# Copy files
echo "Copying files..."
if [ -d "dist" ]; then
    cp -r dist/* /opt/render/project/src/dist/ || true
else
    echo "Warning: dist directory not found after build"
    # Try to build again with more verbose output
    npm run build --verbose
    if [ -d "dist" ]; then
        cp -r dist/* /opt/render/project/src/dist/ || true
    else
        echo "Error: dist directory still not found after second build attempt"
        exit 1
    fi
fi

# Make server.js executable if it exists
if [ -f "/opt/render/project/src/dist/server.js" ]; then
    chmod +x /opt/render/project/src/dist/server.js
    echo "Build completed successfully!"
else
    echo "Error: server.js not found in expected location"
    echo "Contents of /opt/render/project/src/dist:"
    ls -la /opt/render/project/src/dist || true
    exit 1
fi 