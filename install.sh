#!/bin/sh
set -e
echo "Installing MemoryMesh..."
git clone https://github.com/gokayokutucu/memorymesh.git
cd memorymesh
cp .env.example .env
docker compose up -d
npm install
npm run build
echo "MemoryMesh installed successfully!"
echo "Add to Claude Desktop config: see README.md"
