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
# cd into data portal frontend directory
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

### CLI Setup

A Command Line Interface (CLI) is provided to facilitate interaction with the
codebase. The CLI offers various functionalities, including listing services,
managing the development environment, handling production deployments, and
synchronizing photos.

If you are utilizing the Fish shell, you can source the `.env.fish` file to access the `lilnas` CLI:

```fish
source .env.fish
```

For other shells, you can execute the CLI by either running the `lilnas` script directly or sourcing it to enable usage throughout the repository.

```sh
# Execute directly
./lilnas -h

# Source the script
source lilnas
lilnas -h
```

### Sync Container Dependencies

Before starting the development environment, it is essential to install the
dependencies from the container. This step is necessary to avoid any potential
dependency issues related to the container's native environment. For instance,
the tdr-bot backend will not start unless this step is completed.

```sh
lilnas dev sync-deps
```

### Start service

To initiate a service, execute the command `lilnas dev start`. To view a list of
available services, use the command `lilnas ls`:

```sh
# Get list of services
lilnas dev ls

# Start a service in dev mode
lilnas dev start tdr-bot
```
