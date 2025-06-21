# Secure LaTeX compilation sandbox
FROM ubuntu:22.04

# Avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install minimal LaTeX environment and ImageMagick
RUN apt-get update && apt-get install -y \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-extra \
    texlive-fonts-recommended \
    imagemagick \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN useradd -m -u 1001 -s /bin/bash latex

# Configure ImageMagick security policy
COPY image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Create secure texmf configuration
RUN mkdir -p /usr/local/texlive/texmf-local/web2c && \
    echo "openin_any = a" > /usr/local/texlive/texmf-local/web2c/texmf.cnf && \
    echo "openout_any = r" >> /usr/local/texlive/texmf-local/web2c/texmf.cnf && \
    echo "shell_escape = f" >> /usr/local/texlive/texmf-local/web2c/texmf.cnf && \
    echo "allow_unsecure_input = f" >> /usr/local/texlive/texmf-local/web2c/texmf.cnf

# Set resource limits for LaTeX
RUN echo "latex soft nproc 10" >> /etc/security/limits.conf && \
    echo "latex hard nproc 20" >> /etc/security/limits.conf && \
    echo "latex soft fsize 10240" >> /etc/security/limits.conf && \
    echo "latex hard fsize 20480" >> /etc/security/limits.conf

# Create secure working directory
RUN mkdir -p /workspace && \
    chown latex:latex /workspace && \
    chmod 750 /workspace

# Switch to non-root user
USER latex
WORKDIR /workspace

# Set environment variables for security
ENV HOME=/home/latex
ENV TEXMFOUTPUT=/workspace
ENV openout_any=r
ENV openin_any=a

# Default command
ENTRYPOINT ["pdflatex"]
CMD ["-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode"]