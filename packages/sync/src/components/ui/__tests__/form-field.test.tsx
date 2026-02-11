import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FormField } from 'src/components/ui/form-field'

describe('FormField', () => {
  it('renders the label text', () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    )
    expect(screen.getByText('Email')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <FormField label="Name">
        <input data-testid="name-input" />
      </FormField>,
    )
    expect(screen.getByTestId('name-input')).toBeInTheDocument()
  })

  it('does not render an error when error is undefined', () => {
    render(
      <FormField label="Name">
        <input />
      </FormField>,
    )
    expect(screen.queryByText('Invalid email')).not.toBeInTheDocument()
  })

  it('does not render an error when error is null', () => {
    render(
      <FormField label="Name" error={null}>
        <input />
      </FormField>,
    )
    expect(screen.queryByText('Invalid email')).not.toBeInTheDocument()
  })

  it('renders the error message when error is provided', () => {
    render(
      <FormField label="Email" error="Invalid email">
        <input />
      </FormField>,
    )
    expect(screen.getByText('Invalid email')).toBeInTheDocument()
  })

  it('renders hint text when hint is provided', () => {
    render(
      <FormField label="Title" hint="Keep it short and descriptive.">
        <input />
      </FormField>,
    )
    expect(
      screen.getByText('Keep it short and descriptive.'),
    ).toBeInTheDocument()
  })

  it('does not render hint when hint is omitted', () => {
    render(
      <FormField label="Title">
        <input />
      </FormField>,
    )
    // The hint span should not exist in the DOM
    expect(
      screen.queryByText('Keep it short and descriptive.'),
    ).not.toBeInTheDocument()
  })
})
