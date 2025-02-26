import axios from 'axios'

import { env } from './env'

export interface EquationAPIResponse {
  image: string
}

export interface EquationAPIError {
  message: string
  status: number
}

export async function getEquationImage(
  latex: string,
): Promise<EquationAPIResponse | EquationAPIError> {
  const response = await axios.post('https://equations.lilnas.io/equations', {
    latex,
    token: env('EQUATIONS_API_KEY'),
  })

  return response.data
}
