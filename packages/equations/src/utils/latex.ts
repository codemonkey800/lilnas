export function getLatexTemplate(body: string) {
  return `\\documentclass[border=0.25in, varwidth=6in]{standalone}

% Only allow safe packages
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{amsfonts}

\\begin{document}
${body}
\\end{document}`
}
