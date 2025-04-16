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
        echo "Current directory contents:"
        ls -la
        exit 1
    fi
fi

# Copy package.json and package-lock.json
cp package.json package-lock.json /opt/render/project/src/

# Install dependencies in the deployment directory
cd /opt/render/project/src
npm install --production

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