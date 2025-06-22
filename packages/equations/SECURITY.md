# LaTeX Equations Service - Security Implementation

This document outlines the comprehensive security measures implemented to protect the LaTeX equations service from various attack vectors.

## 🛡️ Security Improvements Implemented

### 1. Input Validation & Sanitization

**File**: `src/validation/equation.schema.ts`

- **Zod Schema Validation**: Comprehensive input validation using TypeScript-first schema validation
- **Dangerous Command Detection**: Blocks LaTeX commands that can execute shell commands or access files
- **Package Whitelist**: Only allows safe mathematical packages (amsmath, amssymb, etc.)
- **Content Limits**: 
  - Maximum 2000 characters
  - Maximum 50 LaTeX commands
  - Maximum 20 mathematical expressions
  - Maximum 200 characters per line
- **Structure Validation**: Prevents excessive nesting and ensures balanced braces

### 2. Secure Command Execution

**File**: `src/utils/secure-exec.ts`

- **No Shell Execution**: Uses `spawn()` with `shell: false` to prevent command injection
- **Argument Sanitization**: Removes dangerous shell metacharacters
- **Command Whitelist**: Only allows `pdflatex` and `convert` commands
- **Resource Limits**: 
  - 15-second timeout for LaTeX compilation
  - 30-second timeout for image processing
  - 1MB output buffer limits
  - Restricted environment variables

### 3. LaTeX Security Restrictions

**File**: `src/utils/latex.ts`

- **Disabled Dangerous Commands**: Blocks `\input`, `\include`, `\write`, `\system`, etc.
- **Shell Escape Disabled**: `-no-shell-escape` flag prevents arbitrary command execution
- **Restricted Mode**: Uses `openout_any=p` and `openin_any=p` for paranoid file access
- **Package Restrictions**: Only allows essential math packages

### 4. Local Execution Security

**Current Implementation**: Native system execution (Docker sandbox removed)

- **Input Validation**: Primary security relies on comprehensive input validation
- **Command Sanitization**: Strict argument sanitization and whitelisting
- **LaTeX Restrictions**: Uses `-no-shell-escape` and restricted TeX environment
- **Resource Limits**: Process timeouts and memory limits via ImageMagick policies
- **File System Restrictions**: Uses basename-only file paths and temporary directories

### 5. Rate Limiting & Throttling

**File**: `src/app.module.ts`, `src/equations.controller.ts`

- **Multiple Tiers**:
  - 5 requests per minute (short-term)
  - 20 requests per 15 minutes (medium-term)  
  - 50 requests per hour (long-term)
- **Per-endpoint Limits**: 3 requests per minute for equation creation
- **Concurrent Job Limits**: Maximum 3 simultaneous LaTeX compilations

### 6. Enhanced Error Handling & Logging

**File**: `src/equations.controller.ts`

- **Structured Logging**: JSON-formatted logs with context information
- **Security Event Logging**: Failed authentication attempts, invalid input
- **Error Sanitization**: Internal errors not exposed to clients
- **Bad File Logging**: Automatically stores failed LaTeX files for analysis

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
cd packages/equations
pnpm install
```

### 2. Local LaTeX Setup (Required)

Install LaTeX and ImageMagick on your system:

```bash
# macOS
brew install --cask mactex
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended imagemagick

# CentOS/RHEL/Fedora
sudo yum install texlive-latex texlive-amsmath texlive-amssymb ImageMagick
```

### 3. Environment Variables

Ensure these environment variables are set:

```env
API_TOKEN=your-secure-api-token
MINIO_ACCESS_KEY=your-minio-key
MINIO_SECRET_KEY=your-minio-secret
MINIO_HOST=your-minio-host
MINIO_PORT=9000
MINIO_PUBLIC_URL=https://your-public-minio-url
```

### 4. Verify Installation

Test that required commands are available:

```bash
# Test pdflatex
pdflatex --version

# Test ImageMagick convert
convert --version
```

## 🔒 Security Features

| Feature | Implementation | Purpose |
|---------|---------------|---------|
| Input Validation | Zod schema with regex patterns | Prevent malicious LaTeX injection |
| Command Sanitization | `spawn()` without shell | Prevent command injection |
| Local Execution | Native system commands with restrictions | Reduced attack surface via input validation |
| Rate Limiting | Multi-tier throttling | Prevent DoS attacks |
| Resource Limits | Memory, CPU, timeout restrictions | Prevent resource exhaustion |
| File Access Control | Path restrictions, temporary directories | Prevent unauthorized file access |
| Error Handling | Structured logging, sanitized responses | Prevent information disclosure |

## 🧪 Testing Security

### Test Invalid LaTeX Input

```bash
curl -X POST http://localhost:3000/equations \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your-token",
    "latex": "\\write18{rm -rf /}"
  }'
```

Expected: `400 Bad Request` with validation error

### Test Rate Limiting

```bash
# Send multiple requests quickly
for i in {1..10}; do
  curl -X POST http://localhost:3000/equations \
    -H "Content-Type: application/json" \
    -d '{
      "token": "your-token", 
      "latex": "E = mc^2"
    }' &
done
```

Expected: Some requests return `429 Too Many Requests`

### Test Resource Limits

```bash
curl -X POST http://localhost:3000/equations \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your-token",
    "latex": "\\begin{align}' + "x=1\\\\" * 1000 + '\\end{align}"
  }'
```

Expected: Request should be rejected or timeout safely

## 🚨 Security Monitoring

Monitor these log events for security incidents:

- `Unauthorized equation creation attempt` - Invalid API tokens
- `Invalid input received` - Malicious LaTeX attempts  
- `LaTeX content failed safety checks` - Dangerous content patterns
- `Too many concurrent LaTeX jobs` - Potential DoS attempts
- `Command execution failed` - System execution issues

## 📋 Security Checklist

- [x] Input validation with dangerous command detection
- [x] Shell execution prevention via secure spawn
- [x] LaTeX command restrictions and disabled shell escape
- [x] Local execution with process restrictions
- [x] Rate limiting and concurrent job limits
- [x] Structured error handling and logging
- [x] File access restrictions
- [x] ImageMagick resource limits
- [x] Non-root user execution
- [x] Resource monitoring and limits

## 🔄 Maintenance

### Regular Security Tasks

1. **Update Dependencies**: Keep LaTeX, ImageMagick, and Node.js packages updated
2. **Review Logs**: Monitor for security events and attack patterns
3. **Test Validation**: Regularly test with new malicious LaTeX patterns
4. **System Updates**: Keep LaTeX and ImageMagick system packages updated
5. **Rate Limit Tuning**: Adjust limits based on legitimate usage patterns

### Emergency Response

If a security breach is detected:

1. **Immediate**: Stop the service and isolate the container
2. **Investigate**: Review logs for attack vectors and affected data
3. **Patch**: Apply security fixes and update system packages  
4. **Restart**: Deploy with enhanced monitoring
5. **Report**: Document the incident and lessons learned