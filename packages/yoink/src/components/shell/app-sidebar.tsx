'use client'

import { cns } from '@lilnas/utils/cns'
import {
  Download,
  HardDrive,
  History,
  LayoutGrid,
  Search,
  Shield,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from 'src/components/ui/sidebar'

const mainNav = [
  { label: 'Dashboard', icon: LayoutGrid, href: '/' },
  { label: 'Search', icon: Search, href: '/search' },
  { label: 'Downloads', icon: Download, href: '/downloads' },
  { label: 'History', icon: History, href: '/history' },
  { label: 'Storage', icon: HardDrive, href: '/storage' },
] as const

const adminNav = [{ label: 'Admin', icon: Shield, href: '/admin' }] as const

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <span className="font-mono text-xl font-bold text-terminal text-glow">
          yoink
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {mainNav.map(item => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(pathname, item.href)}
                  tooltip={item.label}
                >
                  <Link
                    href={item.href}
                    className={cns(
                      'border-l-2 border-transparent',
                      isActive(pathname, item.href) && 'border-terminal',
                    )}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              {adminNav.map(item => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, item.href)}
                    tooltip={item.label}
                  >
                    <Link
                      href={item.href}
                      className={cns(
                        'border-l-2 border-transparent',
                        isActive(pathname, item.href) && 'border-terminal',
                      )}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}
