local timer, pending
local stopped = false
local palettes = {
  light = {
    name = 'minihues-light',
    config = {
      background = '#faf4ed',
      foreground = '#575279',
      saturation = 'medium',
      accent = 'purple',
    },
  },
  dark = {
    name = 'minihues-dark',
    config = {
      background = '#191724',
      foreground = '#e0def4',
      saturation = 'lowmedium',
      accent = 'purple',
    },
  },
}

local function observe(result)
  if result.signal ~= 0 then return end
  local stdout, stderr = vim.trim(result.stdout or ''), result.stderr or ''
  if result.code == 0 then
    if stdout == 'Dark' then return 'dark' end
    if stdout == 'Light' then return 'light' end
  elseif result.code == 1 and stdout == '' and stderr:find('AppleInterfaceStyle', 1, true) then
    if stderr:find('Could not find key', 1, true) or stderr:find('does not exist', 1, true) then return 'light' end
  end
end

local function refresh()
  if stopped or not timer or pending then return end
  local ok, process = pcall(
    vim.system,
    { '/usr/bin/defaults', 'read', '-g', 'AppleInterfaceStyle' },
    { text = true, timeout = 1000, env = { LC_ALL = 'C' } },
    vim.schedule_wrap(function(result)
      pending = nil
      if stopped then return end
      local appearance = observe(result)
      local theme = palettes[appearance]
      if not theme or vim.g.colors_name == theme.name then return end
      -- Avoid reloading the old colorscheme when changing 'background'. Restore
      -- its name so MiniHues still clears the old highlights during setup.
      local previous = vim.g.colors_name
      vim.g.colors_name = nil
      vim.o.background = appearance
      vim.g.colors_name = previous
      require('mini.hues').setup(theme.config)
      vim.g.colors_name = theme.name
    end)
  )
  if ok then pending = process end
end

if stopped or timer or vim.fn.has('macunix') ~= 1 then return end

timer = assert(vim.uv.new_timer())
vim.api.nvim_create_autocmd('VimLeavePre', {
  group = vim.api.nvim_create_augroup('MacosAppearance', {}),
  once = true,
  callback = function()
    stopped = true
    timer:stop()
    timer:close()
    if pending then pcall(pending.kill, pending, 9) end
    pending = nil
  end,
})

timer:start(2000, 2000, vim.schedule_wrap(refresh))

refresh()
