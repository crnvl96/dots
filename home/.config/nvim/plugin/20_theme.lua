-- Appearance

local timer, pending
local stopped = false

-- Rosé Pine colors: https://rosepinetheme.com/palette
local palettes = {
  light = {
    name = 'minihues-light',
    colors = {
      base = '#faf4ed',
      surface = '#fffaf3',
      overlay = '#f2e9e1',
      muted = '#9893a5',
      subtle = '#797593',
      text = '#464261',
      love = '#b4637a',
      gold = '#ea9d34',
      rose = '#d7827e',
      pine = '#286983',
      foam = '#56949f',
      iris = '#907aa9',
      highlight_low = '#f4ede8',
      highlight_med = '#dfdad9',
      highlight_high = '#cecacd',
    },
  },
  dark = {
    name = 'minihues-dark',
    colors = {
      base = '#191724',
      surface = '#1f1d2e',
      overlay = '#26233a',
      muted = '#6e6a86',
      subtle = '#908caa',
      text = '#e0def4',
      love = '#eb6f92',
      gold = '#f6c177',
      rose = '#ebbcba',
      pine = '#31748f',
      foam = '#9ccfd8',
      iris = '#c4a7e7',
      highlight_low = '#21202e',
      highlight_med = '#403d52',
      highlight_high = '#524f67',
    },
  },
}

local function blend(fg, bg, alpha)
  local function channel(hex, i) return tonumber(hex:sub(i, i + 1), 16) end
  local function mix(i) return math.floor(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i) + 0.5) end
  return string.format('#%02x%02x%02x', mix(2), mix(4), mix(6))
end

-- Start from the generated MiniHues palette and swap in Rosé Pine colors.
-- Diff and other tinted backgrounds blend the accent into the base.
local function make_palette(c)
  local p = require('mini.hues').make_palette({
    background = c.base,
    foreground = c.text,
  })

  local hues = {
    red = c.love,
    orange = c.rose,
    yellow = c.gold,
    green = c.foam,
    cyan = c.foam,
    azure = c.pine,
    blue = c.pine,
    purple = c.iris,
    accent = c.iris,
  }
  for hue, color in pairs(hues) do
    p[hue], p[hue .. '_bg'] = color, blend(color, c.base, 0.2)
  end
  p.bg_edge, p.bg_mid, p.bg_mid2 = c.surface, c.highlight_low, c.highlight_med
  p.fg_mid, p.fg_mid2 = c.subtle, c.muted
  return p
end

-- Syntax roles follow rose-pine.nvim rather than MiniHues defaults.
local function highlights(c)
  return {
    Boolean = { fg = c.rose },
    Changed = { fg = c.rose },
    Comment = { fg = c.muted, italic = true },
    Constant = { fg = c.gold },
    Delimiter = { fg = c.subtle },
    Function = { fg = c.rose },
    Identifier = { fg = c.text },
    LineNr = { fg = c.muted },
    Operator = { fg = c.subtle },
    PreProc = { fg = c.iris },
    Special = { fg = c.foam },
    Statement = { fg = c.pine, bold = true },
    String = { fg = c.gold },
    Type = { fg = c.foam },
    diffChanged = { fg = c.rose },
    ['@variable.builtin'] = { fg = c.love, bold = true },
    ['@variable.member'] = { fg = c.foam },
    ['@variable.parameter'] = { fg = c.iris, italic = true },
  }
end

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
      -- its name so MiniHues still clears the old highlights when applying.
      local previous = vim.g.colors_name
      vim.g.colors_name = nil
      vim.o.background = appearance
      vim.g.colors_name = previous
      require('mini.hues').apply_palette(make_palette(theme.colors))
      for group, spec in pairs(highlights(theme.colors)) do
        vim.api.nvim_set_hl(0, group, spec)
      end
      require('mini.colors').setup()
      local cs = require('mini.colors').get_colorscheme()
      cs:add_transparency({
        float = true,
        statuscolumn = true,
        statusline = true,
        tabline = true,
        winbar = true,
      }):apply()
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
