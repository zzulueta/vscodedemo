lucide.createIcons();

const toggle = document.querySelector('.menu-toggle');
toggle?.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  toggle.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  document.getElementById('navigation').classList.toggle('open', !expanded);
});

document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.assign('/');
}));

document.querySelectorAll('form').forEach(form => {
  const localTime = form.querySelector('[name="localStartsAt"]');
  if (localTime) {
    const updateTime = () => {
      form.querySelector('[name="startsAt"]').value = localTime.value ? `${localTime.value}:00+08:00` : '';
    };
    localTime.addEventListener('input', updateTime);
    form.addEventListener('submit', updateTime);
  }
  form.addEventListener('submit', () => {
    form.setAttribute('aria-busy', 'true');
  });
});