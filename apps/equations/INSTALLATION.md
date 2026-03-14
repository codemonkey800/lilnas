# Installation Guide for Equations Service

## Local LaTeX Dependencies

The equations service now uses local LaTeX installation instead of Docker sandbox. You need to install the following dependencies on your system:

### macOS

```bash
# Install MacTeX (full LaTeX distribution)
brew install --cask mactex

# Or install BasicTeX (minimal) and add packages as needed
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install amsmath amsfonts amssymb
```

### Ubuntu/Debian

```bash
# Install LaTeX packages
sudo apt-get update
sudo apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended

# Install ImageMagick for image conversion
sudo apt-get install imagemagick
```

### CentOS/RHEL/Fedora

```bash
# Install LaTeX packages
sudo yum install texlive-latex texlive-amsmath texlive-amssymb

# Or on newer versions
sudo dnf install texlive-latex texlive-amsmath texlive-amssymb

# Install ImageMagick
sudo yum install ImageMagick
# Or: sudo dnf install ImageMagick
```

## Required Commands

The service requires these commands to be available in PATH:
- `pdflatex` - For LaTeX compilation
- `convert` - For PDF to PNG conversion (from ImageMagick)

## Verification

Test that the required commands are available:

```bash
# Test pdflatex
pdflatex --version

# Test ImageMagick convert
convert --version
```

## Security Note

Without Docker sandboxing, the service relies on:
- Input validation to block dangerous LaTeX commands
- Rate limiting to prevent abuse
- Resource limits in the secure execution wrapper

For production deployments, consider reinstating Docker sandbox or implementing additional security measures.
