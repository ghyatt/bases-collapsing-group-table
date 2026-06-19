const renderError = (container: HTMLElement, message: string) => {
  // styled via .bcgt-error in styles.css (no inline styles — review gate)
  const wrapper = container.createEl('div', { cls: 'bcgt-error' })
  wrapper.createEl('p', { text: `(Collapsing Group Table) ${message}` })
}

export default renderError
