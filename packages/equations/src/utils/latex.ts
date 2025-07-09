export function getLatexTemplate(body: string) {
  return `\\documentclass[border=0.5in, varwidth=8in]{standalone}

% Only allow safe packages
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{amsfonts}

% Ensure proper text color
\\usepackage{xcolor}
\\color{black}

\\begin{document}
${body}
\\end{document}`
}
