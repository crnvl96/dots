local function copy_file_location()
  local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ':.')
  if path == '' then path = '[No Name]' end
  local mode = vim.fn.mode()
  local is_visual = mode == 'v' or mode == 'V' or mode == '\22'
  local start_line, end_line = vim.fn.line('.'), vim.fn.line('.')
  if is_visual then
    -- '< and '> describe the last completed selection, not the active one.
    -- getregionpos also respects exclusive selections ending at column one.
    local region = vim.fn.getregionpos(vim.fn.getpos('v'), vim.fn.getpos('.'), { type = mode })
    start_line, end_line = region[1][1][2], region[#region][2][2]
  end
  local location = path .. ':' .. start_line
  if start_line ~= end_line then location = location .. '-' .. end_line end
  if vim.fn.has('clipboard') == 0 then
    vim.notify('Failed to copy file location: no clipboard provider', vim.log.levels.ERROR)
    return
  end
  local ok, result = pcall(vim.fn.setreg, '+', location, 'v')
  if not ok or result ~= 0 then
    vim.notify('Failed to copy file location: ' .. tostring(result), vim.log.levels.ERROR)
    return
  end
  if is_visual then vim.cmd.normal({ args = { '\27' }, bang = true }) end
  vim.notify('Copied ' .. location)
end

local scratch_buf, scratch_previous_buf

local function toggle_lua_scratch()
  local current_buf = vim.api.nvim_get_current_buf()
  if current_buf == scratch_buf then
    if scratch_previous_buf and vim.api.nvim_buf_is_valid(scratch_previous_buf) then
      vim.api.nvim_set_current_buf(scratch_previous_buf)
    else
      vim.notify('No previous buffer to return to', vim.log.levels.INFO)
    end
    return
  end

  if not scratch_buf or not vim.api.nvim_buf_is_valid(scratch_buf) then
    scratch_buf = vim.fn.bufadd('/tmp/scratch.lua')
    vim.fn.bufload(scratch_buf)
    vim.bo[scratch_buf].buflisted = true
    vim.bo[scratch_buf].bufhidden = 'hide'
    vim.bo[scratch_buf].filetype = 'lua'
    vim.keymap.set('n', '<Leader>ur', function()
      local code = table.concat(vim.api.nvim_buf_get_lines(scratch_buf, 0, -1, false), '\n')
      local chunk, err = loadstring(code, '@/tmp/scratch.lua')
      if chunk then
        local ok, result = pcall(chunk)
        if not ok then err = result end
      end
      if err then vim.notify(tostring(err), vim.log.levels.ERROR) end
    end, { buffer = scratch_buf, desc = 'Run Lua scratch buffer' })
  end

  vim.api.nvim_set_current_buf(scratch_buf)
  scratch_previous_buf = current_buf
end

vim.keymap.set({ 'n', 'v', 'i', 'o' }, '<Esc>', '<Esc><Cmd>noh<CR>', { desc = 'Clear highlights' })

vim.keymap.set('x', 'p', [["_dP]], { desc = 'Paste in visual mode' })

-- Emacs-style command-line navigation and editing.
vim.keymap.set('c', '<C-a>', '<Home>', { desc = 'Move to start of command line' })
vim.keymap.set('c', '<C-e>', '<End>', { desc = 'Move to end of command line' })
vim.keymap.set('c', '<C-f>', '<Right>', { desc = 'Move forward one character' })
vim.keymap.set('c', '<M-h>', '<C-f>', { desc = 'Open command-line window' })
vim.keymap.set('c', '<C-b>', '<Left>', { desc = 'Move backward one character' })
vim.keymap.set('c', '<M-f>', '<C-Right>', { desc = 'Move forward one word' })
vim.keymap.set('c', '<M-b>', '<C-Left>', { desc = 'Move backward one word' })
vim.keymap.set('c', '<C-p>', '<S-Up>', { desc = 'Previous command in history' })
vim.keymap.set('c', '<C-n>', '<S-Down>', { desc = 'Next command in history' })
vim.keymap.set('c', '<C-u>', '<End><C-u>', { desc = 'Delete entire command line' })
vim.keymap.set('c', '<C-w>', '<C-w>', { desc = 'Delete previous word' })

vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Move to the left window' })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Move to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Move to the upper window' })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Move to the right window' })
vim.keymap.set('n', 'Y', 'yg_', { desc = 'Yank to end of line' })
vim.keymap.set('n', '<C-d>', '<C-d>zz', { desc = 'Scroll down and center' })
vim.keymap.set('n', '<C-u>', '<C-u>zz', { desc = 'Scroll up and center' })

vim.keymap.set('n', '<Leader>wv', '<C-w>v', { desc = 'Split window vertically' })
vim.keymap.set('n', '<Leader>ws', '<C-w>s', { desc = 'Split window horizontally' })
vim.keymap.set('n', '<Leader>wH', '<C-w>H', { desc = 'Move window to the far left' })
vim.keymap.set('n', '<Leader>wJ', '<C-w>J', { desc = 'Move window to the bottom' })
vim.keymap.set('n', '<Leader>wK', '<C-w>K', { desc = 'Move window to the top' })
vim.keymap.set('n', '<Leader>wL', '<C-w>L', { desc = 'Move window to the far right' })
vim.keymap.set('n', '<Leader>wo', '<C-w>o', { desc = 'Close other windows' })
vim.keymap.set('n', '<Leader>wc', '<C-w>c', { desc = 'Close current window' })
vim.keymap.set('n', '<Leader>wx', '<C-w>x', { desc = 'Exchange current window' })

vim.keymap.set('n', '<Leader>us', toggle_lua_scratch, { desc = 'Toggle Lua scratch buffer' })
vim.keymap.set('n', '<Leader>uw', '<Cmd>setlocal wrap!<CR>', { desc = 'Toggle linewrap' })
vim.keymap.set({ 'n', 'x' }, '<Leader>ul', copy_file_location, { desc = 'Copy file location' })

vim.keymap.set('n', '<Leader>uc', function()
  vim.cmd([[G add .]])
  vim.cmd([[G commit --amend --no-edit]])
  vim.cmd([[G push --force-with-lease]])
end, { desc = 'Amend commit without changing message' })
