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
import path from 'path'
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

  private async logBadFile(file: string) {
    this.logger.error({ file }, 'Latex failed to compile')

    const badFilesDir = '/bad-files'
    await fs.ensureDir(badFilesDir)

    const name = path.basename(path.dirname(file))
    const badFile = path.join(badFilesDir, `${name}.tex`)
    await fs.copyFile(file, badFile)
    this.logger.log({ badFile }, 'Stored bad file')
  }

  private async compileLatex({
    dir,
    latex,
    latexFile,
    pngFile,
    pngTmpFile,
  }: {
    dir: string
    latex: string
    latexFile: string
    pngFile: string
    pngTmpFile: string
  }) {
    this.logger.log('Starting latex job')

    if ((await fs.pathExists(dir)) && !(await fs.pathExists(pngFile))) {
      this.logger.error({ dir }, 'Latex job in progress')

      throw new HttpException(
        { info: 'Latex job in progress' },
        HttpStatus.CONFLICT,
      )
    }

    this.logger.log({ dir }, 'Ensuring latex directory')
    await fs.mkdirp(dir)

    const latexContent = getLatexTemplate(latex)

    try {
      this.logger.log('Creating latex file')
      await fs.writeFile(latexFile, latexContent)

      this.logger.log({ file: latexFile }, 'Compiling latex file')
      try {
        await exec(`pdflatex --shell-escape ${latexFile}`, {
          cwd: dir,
          timeout: 10_000,
        })
      } catch (err) {
        this.logBadFile(latexFile)
        throw err
      }

      this.logger.log('Renaming png file to tmp file')
      await fs.rename(pngFile, pngTmpFile)

      this.logger.log('Adding white background to image')
      const { stderr: flattenImageStderr } = await exec(
        `convert ${pngTmpFile} -background white -alpha remove -alpha off ${pngFile}`,
      )

      if (flattenImageStderr) {
        throw new Error(`Failed to flatten png`)
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
    this.logger.log({ dir }, 'Cleaning up latex directory')
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
    const pngTmpFile = `${dir}/equation-tmp.png`

    try {
      await this.compileLatex({
        dir,
        latex,
        latexFile,
        pngFile,
        pngTmpFile,
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
