import { expect, test } from '@playwright/test'

const avatar = '/profile-avatar.svg'
const user = {
  id: 'users:admin', username: 'admin', display_name: 'Account name',
  email: 'owner@example.test', avatar_url: '/old-account-avatar.svg'
}

// Browser-only fixtures exercise the real UI without changing an owner's data.
test.beforeEach(async ({ page }) => {
  let loggedIn = true
  let settings: Record<string, unknown> = {
    owner_name: 'Public Owner', owner_avatar: avatar, owner_motto: 'Hello',
    owner_bio_visible: true, graph_view_enabled: false, publish_heatmap_enabled: false
  }
  await page.addInitScript(() => localStorage.setItem('pb-admin-sidebar-collapsed', '0'))
  await page.route('**/*avatar*.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="teal"/></svg>'
  }))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    let body: unknown
    if (path === '/api/auth/setup-status') body = { completed: true }
    else if (path === '/api/auth/session') body = { loggedIn, user: loggedIn ? user : null }
    else if (path === '/api/auth/me') body = { user: { ...user, ...route.request().postDataJSON() } }
    else if (path === '/api/auth/logout') {
      loggedIn = false
      body = { ok: true }
    }
    else if (path === '/api/auth/change-password') body = { ok: true }
    else if (path === '/api/admin/settings') {
      if (route.request().method() === 'POST') settings = { ...settings, ...route.request().postDataJSON() }
      body = { settings }
    }
    else if (path === '/api/site/bootstrap') body = { settings, tags: [], categories: [], theme: null, themeMode: 'light' }
    else if (path === '/api/site/settings/media') body = { settings: { public_base_url: '' } }
    else if (path === '/api/posts') body = { posts: [], total: 0, limit: 15, start: 0 }
    else if (path === '/api/_auth/session') body = { user: loggedIn ? user : null }
    else if (path.startsWith('/api/_nuxt_icon/') || path === '/api/theme/css') return route.continue()
    else return route.abort()
    await route.fulfill({ json: body })
  })
  await page.goto('/login?redirect=/admin/settings/profile')
  await expect(page.locator('.pb-admin-sidebar')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
})

test('keeps Profile as the only account destination and pins Sign out to the sidebar bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const sidebar = page.locator('.pb-admin-sidebar')
  await expect(sidebar.locator('a[href="/admin/settings/profile"]')).toHaveCount(1)
  await expect(sidebar.locator('a[href="/admin/settings/account"]')).toHaveCount(0)
  await expect(page.locator('header').getByRole('button', { name: /My profile|Sign out/ })).toHaveCount(0)
  const signOut = page.getByTestId('admin-sign-out')
  expect(await signOut.evaluate(element => element.parentElement?.classList.contains('pb-admin-sidebar'))).toBe(true)
  const footer = await signOut.boundingBox()
  const backup = await sidebar.locator('a[href="/admin/backups"]').boundingBox()
  expect(footer!.y - (backup!.y + backup!.height)).toBeGreaterThan(100)
  expect(1200 - (footer!.y + footer!.height)).toBeLessThanOrEqual(20)

  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(signOut).toBeVisible()
  await expect(signOut).toHaveAccessibleName('Sign out')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('admin-mobile-menu-button').click()
  await expect(signOut).toBeVisible()
  const mobileFooter = await signOut.boundingBox()
  expect(844 - (mobileFooter!.y + mobileFooter!.height)).toBeLessThanOrEqual(20)
})

test('merges account controls into Profile and keeps the old account URL working', async ({ page }) => {
  await expect(page.locator('input[autocomplete="email"]')).toHaveValue(user.email)
  await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible()
  await page.locator('input[autocomplete="email"]').fill('updated@example.test')
  const accountSave = page.waitForRequest(request => request.url().endsWith('/api/auth/me') && request.method() === 'PUT')
  await page.locator('main form').nth(1).getByRole('button', { name: 'Save profile' }).click()
  expect((await accountSave).postDataJSON()).toEqual({ display_name: user.display_name, email: 'updated@example.test' })
  await page.locator('input[autocomplete="current-password"]').fill('Current-password1!')
  await page.locator('input[autocomplete="new-password"]').first().fill('Next-password2!')
  await page.locator('input[autocomplete="new-password"]').last().fill('Next-password2!')
  const passwordSave = page.waitForRequest(request => request.url().endsWith('/api/auth/change-password'))
  await page.locator('main form').last().getByRole('button', { name: 'Change password' }).click()
  expect((await passwordSave).postDataJSON()).toMatchObject({ current_password: 'Current-password1!', new_password: 'Next-password2!' })

  await page.goto('/login?redirect=/admin/settings/account')
  await expect(page).toHaveURL(/\/admin\/settings\/profile$/)
})

test('uses the same saved avatar in admin and the public owner card', async ({ page }) => {
  await expect(page.locator('header img[alt="Public Owner"]')).toHaveAttribute('src', avatar)
  const profileForm = page.locator('main form').first()
  await profileForm.locator('input').nth(2).fill('/updated-avatar.svg')
  await profileForm.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.locator('header img[alt="Public Owner"]')).toHaveAttribute('src', '/updated-avatar.svg')
  await page.getByRole('link', { name: 'View site' }).click()
  await expect(page).toHaveURL(/\/$/)
  const avatars = page.locator('img[alt="Public Owner"]')
  await expect(avatars).toHaveCount(1)
  for (const image of await avatars.all()) await expect(image).toHaveAttribute('src', '/updated-avatar.svg')
  await expect(page.getByRole('button', { name: /My profile|Sign out/ })).toHaveCount(0)
})

test('reports sign-out failure and allows retry from the sidebar', async ({ page }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 500, json: { message: 'Sign out unavailable' } }))
  await page.getByTestId('admin-sign-out').click()
  await expect(page.getByText('Sign out unavailable', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/settings\/profile$/)
  await expect(page.getByTestId('admin-sign-out')).toBeEnabled()
  await page.unroute('**/api/auth/logout')
  await page.getByTestId('admin-sign-out').click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
})
