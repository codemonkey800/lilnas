export function getLatexTemplate(body: string) {
  return `
    \\documentclass[convert={density=500}, border=2pt, varwidth=8in]{standalone}

    \\usepackage{amsmath}
    \\usepackage{amssymb}

    \\begin{document}

    ${body}

    \\end{document}
  `
}
