import {
  Body,
  Controller,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { exec as execBase } from 'child_process'
import * as fs from 'fs-extra'
import { promisify } from 'util'

import { env } from './utils/env'
import { getErrorMessage } from './utils/error'
import { getLatexTemplate } from './utils/latex'

const exec = promisify(execBase)

class CreateEquationDto {
  token!: string
  latex!: string
}

@Controller('equations')
export class EquationsController {
  private readonly logger = new Logger(EquationsController.name)

  private async compileLatex({
    dir,
    latex,
    latexFile,
    pngFile,
  }: {
    dir: string
    latex: string
    latexFile: string
    pngFile: string
  }) {
    this.logger.log({ info: 'Starting latex job' })

    if ((await fs.pathExists(dir)) && !(await fs.pathExists(pngFile))) {
      throw new HttpException(
        { info: 'Latex job in progress' },
        HttpStatus.CONFLICT,
      )
    }

    this.logger.log({ info: 'Ensuring latex directory', dir })
    await fs.mkdirp(dir)

    const latexContent = getLatexTemplate(latex)

    try {
      this.logger.log({ info: 'Creating latex file' })
      await fs.writeFile(latexFile, latexContent)

      this.logger.log({ info: 'Compiling latex file', file: latexFile })
      const { stderr } = await exec(`pdflatex --shell-escape ${latexFile}`, {
        cwd: dir,
      })

      if (
        (stderr && !stderr.includes('RGB color space not permitted')) ||
        !(await fs.pathExists(pngFile))
      ) {
        throw new Error(`Failed to compile latex ${stderr}`)
      }
    } catch (err) {
      const error = getErrorMessage(err)

      throw new HttpException(
        { info: 'Failed to compile latex', error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  private async getLatexPngBase64(file: string) {
    const base64 = await fs.readFile(file, 'base64')
    return `data:image/png;base64,${base64}`
  }

  private async cleanupLatex(dir: string) {
    this.logger.log({ info: 'Cleaning up latex directory', dir })
    await fs.remove(dir)
  }

  @Post()
  @Header('Content-Type', 'application/json')
  async createEquation(@Body() { token, latex }: CreateEquationDto) {
    if (token !== env('API_TOKEN')) {
      throw new UnauthorizedException()
    }

    const now = Date.now()
    const dir = `/math/${now}`
    const latexFile = `${dir}/equation.tex`
    const pngFile = `${dir}/equation.png`

    try {
      await this.compileLatex({
        dir,
        latex,
        latexFile,
        pngFile,
      })
      const latexPngBase64 = await this.getLatexPngBase64(pngFile)

      return {
        image: latexPngBase64,
      }
    } finally {
      await this.cleanupLatex(dir)
    }
  }
}
