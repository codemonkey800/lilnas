import { cns } from '@lilnas/utils/cns'
import * as Label from '@radix-ui/react-label'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'

interface SelectDropdownProps {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
}

export const SelectDropdown = ({
  label,
  value,
  onValueChange,
  options,
  placeholder = 'Select an option',
}: SelectDropdownProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col gap-2"
    >
      <Label.Root
        className={cns('text-sm font-medium text-gray-700 dark:text-gray-300')}
      >
        {label}
      </Label.Root>
      <Select.Root value={value} onValueChange={onValueChange}>
        <Select.Trigger
          className={cns(
            'inline-flex items-center justify-between gap-2',
            'rounded-lg border border-gray-300 bg-white',
            'px-4 py-3 text-sm font-medium text-gray-900',
            'shadow-sm transition-all',
            'hover:border-purple-400 hover:shadow-md',
            'focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2',
            'data-[state=open]:border-purple-500 data-[state=open]:ring-2 data-[state=open]:ring-purple-500',
            'dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100',
            'dark:hover:border-purple-400 dark:focus:ring-offset-gray-800',
          )}
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon>
            <ChevronDown
              className={cns('h-4 w-4 text-gray-500 dark:text-gray-400')}
            />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className={cns(
              'overflow-hidden rounded-lg border',
              'border-gray-200 bg-white shadow-lg',
              'dark:border-gray-700 dark:bg-gray-700',
            )}
            position="popper"
            sideOffset={5}
          >
            <Select.Viewport className="max-h-[60vh] overflow-y-auto p-1">
              {options.map(option => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className={cns(
                    'relative flex cursor-pointer items-center',
                    'rounded-md px-8 py-2 text-sm text-gray-900',
                    'outline-none transition-colors',
                    'hover:bg-purple-50 focus:bg-purple-50',
                    'data-[state=checked]:bg-purple-100 data-[state=checked]:font-medium',
                    'dark:text-gray-100 dark:hover:bg-gray-600',
                    'dark:focus:bg-gray-600 dark:data-[state=checked]:bg-gray-600',
                  )}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator
                    className={cns('absolute left-2 inline-flex items-center')}
                  >
                    <Check
                      className={cns(
                        'h-4 w-4 text-purple-600 dark:text-purple-400',
                      )}
                    />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </motion.div>
  )
}
