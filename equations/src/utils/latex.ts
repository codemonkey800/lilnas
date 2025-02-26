export function getLatexTemplate(body: string) {
  return `
    \\documentclass[convert={density=500}, border=0.25in, varwidth=6in]{standalone}

    \\usepackage{amsmath}
    \\usepackage{amssymb}

    \\begin{document}

    ${body}

    \\end{document}
  `
}
