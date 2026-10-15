rex.bind('ctrl+k>c', 'client.tab.new')
rex.bind('ctrl+k>n', 'client.tab.next')
rex.bind('ctrl+k>p', 'client.tab.previous')

-- % and " on a US layout
rex.bind('ctrl+k>shift+5', 'pane.split', { direction = 'right' })
rex.bind("ctrl+k>shift+'", 'pane.split', { direction = 'down' })
rex.bind('ctrl+k>z', 'pane.zoom')
rex.bind('ctrl+k>x', 'pane.close')

-- Press Ctrl+B twice to send one to the terminal
rex.bind('ctrl+k>ctrl+k', 'pane.send_key', { key = 'ctrl+k' })
