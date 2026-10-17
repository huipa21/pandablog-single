import { expect, test } from '@playwright/test'

const avatar = '/profile-avatar.svg'
const user = {
  id: 'users:admin', username: 'admin', display_name: 'Account name',
  email: 'owner@example.test', avatar_url: '/old-account-avatar.svg'
}

// Browser-only fixtures exercise the real UI without changing an owner's data.
test.beforeEach(async ({ page }) => {
  let loggedIn = true
  let profile = { ...user }
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
    else if (path === '/api/auth/session') body = { loggedIn, user: loggedIn ? profile : null }
    else if (path === '/api/auth/me') {
      if (route.request().method() === 'PUT') profile = { ...profile, ...route.request().postDataJSON() }
      body = { user: profile }
    }
    else if (path === '/api/auth/logout') {
      loggedIn = false
      body = { ok: true }
    }
    else if (path === '/api/auth/change-password') {
      loggedIn = false
      body = { ok: true }
    }
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
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
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

test('has one Profile form, one display name, and no Account section', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toHaveCount(0)
  await expect(page.locator('main form')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toHaveCount(1)
  await expect(page.getByPlaceholder('/uploads/... or https://...', { exact: true })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Public Owner')
  await expect(page.getByRole('banner')).toContainText('Public Owner')
  await expect(page.getByRole('banner')).not.toContainText('Account name')
  await expect(page.locator('input[autocomplete="email"]')).toHaveValue(user.email)
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Unified Owner')
  await page.locator('input[autocomplete="email"]').fill('updated@example.test')
  const accountSave = page.waitForRequest(request => request.url().endsWith('/api/auth/me') && request.method() === 'PUT')
  const profileSave = page.waitForRequest(request => request.url().endsWith('/api/admin/settings') && request.method() === 'POST')
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  expect((await accountSave).postDataJSON()).toEqual({ email: 'updated@example.test' })
  expect((await profileSave).postDataJSON()).toMatchObject({ owner_name: 'Unified Owner', owner_avatar: avatar })
  await expect(page.getByRole('banner')).toContainText('Unified Owner')

  await page.goto('/login?redirect=/admin/settings/account')
  await expect(page).toHaveURL(/\/admin\/settings\/profile$/)
  await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Unified Owner')
  await expect(page.locator('input[autocomplete="email"]')).toHaveValue('updated@example.test')
})

test('uses the same saved display name and avatar in admin and the public owner card', async ({ page }) => {
  await expect(page.locator('header img[alt="Public Owner"]')).toHaveAttribute('src', avatar)
  const profileForm = page.locator('main form').first()
  await profileForm.getByRole('textbox', { name: 'Display name', exact: true }).fill('Unified Owner')
  await profileForm.getByPlaceholder('/uploads/... or https://...', { exact: true }).fill('/updated-avatar.svg')
  await profileForm.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByRole('banner')).toContainText('Unified Owner')
  await expect(page.locator('header img[alt="Unified Owner"]')).toHaveAttribute('src', '/updated-avatar.svg')
  await page.getByRole('link', { name: 'View site' }).click()
  await expect(page).toHaveURL(/\/$/)
  const avatars = page.locator('img[alt="Unified Owner"]')
  await expect(avatars).toHaveCount(1)
  for (const image of await avatars.all()) await expect(image).toHaveAttribute('src', '/updated-avatar.svg')
  await expect(page.getByRole('button', { name: /My profile|Sign out/ })).toHaveCount(0)
  await expect(page.locator('[data-public-sidebar]')).toContainText('Unified Owner')
})

test('opens password reset only in a popup and clears passwords on cancel', async ({ page }) => {
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reset password', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Current password', { exact: true }).fill('Current-password1!')
  await dialog.getByLabel('New password', { exact: true }).fill('Next-password2!')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(dialog.getByLabel('Current password', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('validates password reset, keeps errors in the popup flow, and signs out after success', async ({ page }) => {
  let passwordRequests = 0
  page.on('request', request => { if (request.url().endsWith('/api/auth/change-password')) passwordRequests += 1 })
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reset password', exact: true })
  await dialog.getByLabel('Current password', { exact: true }).fill('Current-password1!')
  await dialog.getByLabel('New password', { exact: true }).fill('Next-password2!')
  await dialog.getByLabel('Confirm new password', { exact: true }).fill('Mismatch-password3!')
  await dialog.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(dialog.getByText('Passwords do not match', { exact: true })).toBeVisible()
  expect(passwordRequests).toBe(0)
  await dialog.getByLabel('Confirm new password', { exact: true }).fill('Next-password2!')
  await page.route('**/api/auth/change-password', route => route.fulfill({ status: 400, json: { message: 'Current password is incorrect' } }))
  await dialog.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByText('Current password is incorrect', { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Reset password', exact: true })).toBeEnabled()
  await page.unroute('**/api/auth/change-password')
  const passwordSave = page.waitForRequest(request => request.url().endsWith('/api/auth/change-password'))
  await dialog.getByRole('button', { name: 'Reset password', exact: true }).click()
  expect((await passwordSave).postDataJSON()).toEqual({
    current_password: 'Current-password1!', new_password: 'Next-password2!', confirm_password: 'Next-password2!'
  })
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
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
