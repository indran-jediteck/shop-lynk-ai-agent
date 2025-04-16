#!/bin/bash

# Install dependencies
npm install

# Build TypeScript
npm run build

# Create the directory structure Render expects
mkdir -p /opt/render/project/src/dist

# Copy the built files to Render's expected location
cp -r dist/* /opt/render/project/src/dist/

# Make sure the server.js is executable
chmod +x /opt/render/project/src/dist/server.js 