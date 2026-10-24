vim.cmd('setlocal nospell')
vim.cmd('setlocal wrap')
vim.cmd('setlocal foldmethod=expr foldexpr=v:lua.vim.treesitter.foldexpr() foldlevel=1')

local has_mini_ai, mini_ai = pcall(require, 'mini.ai')
if has_mini_ai then
  vim.b.miniai_config = {
    custom_textobjects = {
      ['*'] = mini_ai.gen_spec.pair('*', '*', { type = 'greedy' }),
      ['_'] = mini_ai.gen_spec.pair('_', '_', { type = 'greedy' }),
    },
  }
end

vim.b.minisurround_config = {
  custom_surroundings = {
    -- Bold
    ['B'] = { input = { '%*%*().-()%*%*' }, output = { left = '**', right = '**' } },
    -- Italic
    ['I'] = { input = { '%_().-()%_' }, output = { left = '_', right = '_' } },
    -- Link
    L = {
      input = { '%[().-()%]%(.-%)' },
      output = function()
        local link = require('mini.surround').user_input('Link')
        return { left = '[', right = '](' .. link .. ')' }
      end,
    },
  },
}
