#!/bin/bash

echo "Building LaTeX sandbox Docker image..."
docker build -f latex-sandbox.dockerfile -t lilnas/latex-sandbox:latest .

if [ $? -eq 0 ]; then
    echo "✅ LaTeX sandbox image built successfully"
    echo "Testing the image..."
    
    # Create a test directory and LaTeX file
    mkdir -p /tmp/latex-test
    echo '\documentclass{standalone}
\usepackage{amsmath}
\begin{document}
$x^2 + 2x + 1 = 0$
\end{document}' > /tmp/latex-test/test.tex
    
    # Test compilation
    docker run --rm \
        -v /tmp/latex-test:/workspace:rw \
        --user=1001:1001 \
        lilnas/latex-sandbox:latest \
        -no-shell-escape \
        -halt-on-error \
        -interaction=nonstopmode \
        test.tex
    
    if [ $? -eq 0 ]; then
        echo "✅ LaTeX compilation test passed"
    else
        echo "❌ LaTeX compilation test failed"
    fi
    
    # Clean up
    rm -rf /tmp/latex-test
else
    echo "❌ Docker build failed"
    exit 1
fi