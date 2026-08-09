const header = document.querySelector('[data-site-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-site-menu]');

function updateHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 12);
}

function closeMenu() {
  if (!(menuToggle instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) {
    return;
  }

  menuToggle.setAttribute('aria-expanded', 'false');
  menu.classList.remove('is-open');
}

if (menuToggle instanceof HTMLButtonElement && menu instanceof HTMLElement) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menu.classList.toggle('is-open', !isOpen);
  });

  menu.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuToggle.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && !menu.contains(event.target) && !menuToggle.contains(event.target)) {
      closeMenu();
    }
  });
}

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });
