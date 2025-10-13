# lilnas

Repo for configuration files and application source code for my self-hosted nas
server named lilnas.

## Quick Start

First, ensure that Node.js and Docker are installed on your system.

### Docker Setup

To install Docker, please visit [Docker's official website](https://www.docker.com/get-started/).

### Node Setup

For installing Node.js, it is recommended to use Node Version Manager (nvm). You
can download and install nvm for your preferred shell:

- Bash: [nvm](https://github.com/nvm-sh/nvm)
- Fish: [nvm.fish](https://github.com/jorgebucaran/nvm.fish)
- Zsh: [zsh-nvm](https://github.com/lukechilds/zsh-nvm)

Next you can install node, pnpm, and the project dependencies:

```sh
# cd into lilnas directory
cd ~/dev/lilnas

# installs Node.js version defined in `.nvmrc`
nvm install

# uses project defined Node.js version
nvm use

# install pnpm globally
npm -g install pnpm

# install project dependencies
pnpm install
```

### Development Setup

If you are utilizing the Fish shell, you can source the `.env.fish` file to set up the Node.js environment:

```fish
source .env.fish
```

### Docker Compose Service Management

Use Docker Compose to manage services in the development environment:

```sh
# Start all services in development mode
docker-compose -f docker-compose.dev.yml up -d

# Start a specific service
docker-compose -f docker-compose.dev.yml up -d tdr-bot

# View logs for a service
docker-compose -f docker-compose.dev.yml logs -f tdr-bot

# Stop services
docker-compose -f docker-compose.dev.yml down
```
