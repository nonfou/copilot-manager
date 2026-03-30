import { h } from 'vue'
import { NButton, NTooltip, NPopconfirm, NIcon } from 'naive-ui'
import type { Component } from 'vue'

interface ActionButtonOptions {
  icon: Component
  tooltip: string
  type?: 'default' | 'primary' | 'warning' | 'info'
  onClick: () => void
}

interface DangerActionOptions {
  icon: Component
  tooltip: string
  confirmText: string
  type?: 'error' | 'warning'
  onConfirm: () => void
}

export function renderActionButton(opts: ActionButtonOptions) {
  return h(
    NTooltip,
    { trigger: 'hover', placement: 'top', delay: 300 },
    {
      trigger: () =>
        h(
          NButton,
          {
            quaternary: true,
            circle: true,
            size: 'small',
            type: opts.type || 'default',
            onClick: opts.onClick,
          },
          { default: () => h(NIcon, { size: 16 }, { default: () => h(opts.icon) }) },
        ),
      default: () => opts.tooltip,
    },
  )
}

export function renderDangerButton(opts: DangerActionOptions) {
  return h(
    NPopconfirm,
    { positiveText: '确认', negativeText: '取消', onPositiveClick: opts.onConfirm },
    {
      trigger: () =>
        h(
          NButton,
          {
            quaternary: true,
            circle: true,
            size: 'small',
            type: opts.type || 'error',
          },
          { default: () => h(NIcon, { size: 16 }, { default: () => h(opts.icon) }) },
        ),
      default: () => opts.confirmText,
    },
  )
}
