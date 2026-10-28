-- Appearance
--
-- Inherit the host terminal palette. Ghostty already switches
-- `light:Rose Pine Dawn,dark:Rose Pine` and answers OSC 10/11/4. Neovim sets
-- 'background' from OSC 11, including after a DEC 2031 theme notification
-- (CSI ? 997) and after resume. This file re-queries the whole palette then.
-- It does not set 'background' or g:colors_name: a named scheme would be
-- reloaded when Neovim updates 'background'.

local debounce, reported, current, applied
local stopped = false
local querying = false

local function blend(fg, bg, alpha)
  local function channel(hex, i) return tonumber(hex:sub(i, i + 1), 16) end
  local function mix(i) return math.floor(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i) + 0.5) end
  return string.format('#%02x%02x%02x', mix(2), mix(4), mix(6))
end

-- 0 black, 1 red, 2 green, 3 yellow, 4 blue, 5 magenta, 6 cyan, 8 bright black.
-- surface, subtle, and the highlight steps are not in the terminal palette,
-- so blend them from the background, foreground, black, and bright black.
local function colors_from_terminal(bg, fg, ansi)
  local black, bright_black = ansi[0], ansi[8]
  return {
    bg = bg,
    fg = fg,
    red = ansi[1],
    green = ansi[2],
    yellow = ansi[3],
    blue = ansi[4],
    magenta = ansi[5],
    cyan = ansi[6],
    muted = bright_black,
    subtle = blend(fg, bright_black, 0.35),
    surface = blend(black, bg, 0.45),
    highlight_low = blend(bright_black, bg, 0.12),
    highlight_med = blend(bright_black, bg, 0.35),
  }
end

-- Start from the generated MiniHues palette and swap in terminal colors.
-- Diff and other tinted backgrounds blend the accent into the base.
local function make_palette(c)
  local p = require('mini.hues').make_palette({
    background = c.bg,
    foreground = c.fg,
  })

  -- MiniHues has more hue names than ANSI slots. Keep the existing assignment.
  local hues = {
    red = c.red,
    orange = c.cyan,
    yellow = c.yellow,
    green = c.blue,
    cyan = c.blue,
    azure = c.green,
    blue = c.green,
    purple = c.magenta,
    accent = c.magenta,
  }
  for hue, color in pairs(hues) do
    p[hue], p[hue .. '_bg'] = color, blend(color, c.bg, 0.2)
  end
  p.bg_edge, p.bg_mid, p.bg_mid2 = c.surface, c.highlight_low, c.highlight_med
  p.fg_mid, p.fg_mid2 = c.subtle, c.muted
  return p
end

-- Syntax colors are terminal ANSI colors, not MiniHues' generated hues.
local function highlights(c)
  return {
    Boolean = { fg = c.cyan },
    Changed = { fg = c.cyan },
    Comment = { fg = c.muted, italic = true },
    Constant = { fg = c.yellow },
    Delimiter = { fg = c.subtle },
    Function = { fg = c.cyan },
    Identifier = { fg = c.fg },
    LineNr = { fg = c.muted },
    Operator = { fg = c.subtle },
    PreProc = { fg = c.magenta },
    Special = { fg = c.blue },
    Statement = { fg = c.green, bold = true },
    String = { fg = c.yellow },
    Type = { fg = c.blue },
    diffChanged = { fg = c.cyan },
    MiniPickMatchCurrent = { fg = c.cyan },
    ['@variable.builtin'] = { fg = c.red, bold = true },
    ['@variable.member'] = { fg = c.blue },
    ['@variable.parameter'] = { fg = c.magenta, italic = true },
  }
end

local function fingerprint(c)
  return table.concat({
    c.bg,
    c.surface,
    c.muted,
    c.subtle,
    c.fg,
    c.red,
    c.green,
    c.yellow,
    c.blue,
    c.magenta,
    c.cyan,
    c.highlight_low,
    c.highlight_med,
  }, ',')
end

local function apply(c, force)
  if stopped then return end
  -- A repeated palette still finishes the query. Otherwise 'background'
  -- changes stop restoring highlights while a no-op reply is in flight.
  querying = false
  local id = fingerprint(c)
  if not force and id == applied then return end
  -- apply_palette clears an existing scheme only when g:colors_name is set.
  -- Clear here, then leave the name unset so Neovim's 'background' update
  -- does not try to reload a colorscheme.
  vim.cmd('highlight clear')
  vim.g.colors_name = nil
  require('mini.hues').apply_palette(make_palette(c))
  for group, spec in pairs(highlights(c)) do
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
  vim.g.colors_name = nil
  applied = id
  current = c
end

local function ready(t)
  if not t.bg or not t.fg then return false end
  for i = 0, 15 do
    if not t[i] then return false end
  end
  return true
end

local function schedule_apply()
  if stopped or not ready(reported) then return end
  debounce:start(
    80,
    0,
    vim.schedule_wrap(function()
      if stopped or not ready(reported) then return end
      apply(colors_from_terminal(reported.bg, reported.fg, reported))
    end)
  )
end

local function channel(hex)
  if not hex or #hex == 0 or #hex > 4 or not hex:match('^%x+$') then return nil end
  local value = tonumber(hex, 16)
  local max = tonumber(string.rep('f', #hex), 16)
  if not value or not max or max == 0 then return nil end
  return math.floor(value / max * 255 + 0.5)
end

local function hex_color(r, g, b)
  local rr, gg, bb = channel(r), channel(g), channel(b)
  if not rr or not gg or not bb then return nil end
  return string.format('#%02x%02x%02x', rr, gg, bb)
end

local function parse_spec(spec)
  local r, g, b = spec:match('^[rR][gG][bB]:(%x+)/(%x+)/(%x+)')
  if not r then
    r, g, b = spec:match('^[rR][gG][bB][aA]:(%x+)/(%x+)/(%x+)/%x+')
  end
  if not r then return nil end
  return hex_color(r, g, b)
end

local function parse(seq)
  seq = seq:gsub('\027\\$', ''):gsub('\007$', '')
  local which, spec = seq:match('^\027%]1([01]);(.+)$')
  if which then
    local color = parse_spec(spec)
    if which == '0' then return 'fg', color end
    return 'bg', color
  end
  local idx, body = seq:match('^\027%]4;(%d+);(.+)$')
  idx = tonumber(idx)
  if idx and idx >= 0 and idx <= 15 then return idx, parse_spec(body) end
end

local query_id = 0

local function query()
  if stopped then return end
  query_id = query_id + 1
  local id = query_id
  querying = true
  reported = {}
  local parts = { '\027]10;?\007', '\027]11;?\007' }
  for i = 0, 15 do
    parts[#parts + 1] = string.format('\027]4;%d;?\007', i)
  end
  vim.api.nvim_ui_send(table.concat(parts))
  -- If the terminal never replies, don't leave highlight restoration disabled.
  vim.defer_fn(function()
    if stopped or id ~= query_id or not querying then return end
    querying = false
    if current then apply(current, true) end
  end, 1000)
end

local function theme_notification(seq) return seq:match('^\027%[?997;[12]n$') or seq:match('^\027%[997;[12]n$') end

local group = vim.api.nvim_create_augroup('TerminalPalette', { clear = true })
debounce = assert(vim.uv.new_timer())
reported = {}

vim.api.nvim_create_autocmd('VimLeavePre', {
  group = group,
  once = true,
  callback = function()
    stopped = true
    debounce:stop()
    debounce:close()
  end,
})

vim.api.nvim_create_autocmd('TermResponse', {
  group = group,
  callback = function(ev)
    local seq = ev.data.sequence
    if theme_notification(seq) then
      query()
      return
    end
    local key, color = parse(seq)
    if key == nil or not color then return end
    reported[key] = color
    schedule_apply()
  end,
})

-- Neovim resets default highlights when 'background' changes. Reapply unless
-- a palette query is already in flight and will apply the new colors.
vim.api.nvim_create_autocmd('OptionSet', {
  group = group,
  pattern = 'background',
  callback = function()
    -- The background setter resets highlights before this runs, and a
    -- synchronous reapply survives that reset. Deferring it leaves a frame
    -- of default colors.
    if stopped or querying or not current then return end
    apply(current, true)
  end,
})

vim.api.nvim_create_autocmd({ 'UIEnter', 'VimResume' }, {
  group = group,
  callback = query,
})

if #vim.api.nvim_list_uis() > 0 then query() end
