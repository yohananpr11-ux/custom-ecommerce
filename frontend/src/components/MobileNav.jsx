import { useEffect, useState } from 'react';

export default function MobileNav({
  logo,
  cartLabel,
  cartCount = 0,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onCartClick,
  onMenuClick,
  onLogoClick,
  onBackClick,
  showMenu = false,
  showBack = false,
  showBottomTabs = false,
  onOpenCategories,
}) {
  const [scrollDirection, setScrollDirection] = useState('up');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const updateScrollDirection = () => {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollY;
      if (Math.abs(delta) < 6) return;
      setScrollDirection(delta > 0 ? 'down' : 'up');
      lastScrollY = scrollY > 0 ? scrollY : 0;
    };

    window.addEventListener('scroll', updateScrollDirection, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollDirection);
  }, []);

  const shouldHide = scrollDirection === 'down' && window.scrollY > 48;

  return (
    <>
      <header className={`mobile-nav-shell ${shouldHide ? 'hide' : ''}`}>
        <div className="mobile-nav-top">
          <div className="mobile-nav-leading">
            {showMenu && (
              <button type="button" className="mobile-nav-icon-btn" onClick={onMenuClick} aria-label="Open menu">
                <span className="mobile-nav-burger" />
                <span className="mobile-nav-burger" />
                <span className="mobile-nav-burger" />
              </button>
            )}
            {showBack && (
              <button type="button" className="mobile-nav-icon-btn" onClick={onBackClick} aria-label="Go back">
                {'<'}
              </button>
            )}
            <button type="button" className="mobile-nav-logo" onClick={onLogoClick} aria-label="Drip Street Shop Home">
              {logo}
            </button>
          </div>

          <div className="mobile-nav-actions">
            <button
              type="button"
              className="mobile-nav-icon-btn"
              onClick={() => setSearchOpen((prev) => !prev)}
              aria-label="Toggle search"
            >
              Srch
            </button>
            <button type="button" className="mobile-nav-icon-btn" onClick={onCartClick} aria-label="Open cart">
              <span>Cart</span>
              {cartCount > 0 && <span className="mobile-nav-cart-badge">{cartCount}</span>}
            </button>
          </div>
        </div>

        <div className={`mobile-nav-search ${searchOpen ? 'open' : ''}`}>
          <input
            type="text"
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search products"
          />
        </div>
      </header>

      <div className="mobile-nav-spacer" />

      {showBottomTabs && (
        <nav className="mobile-tabbar" aria-label="Mobile quick navigation">
          <button type="button" onClick={onLogoClick}>Home</button>
          <button type="button" onClick={onOpenCategories}>Shop</button>
          <button type="button" onClick={onCartClick}>{cartLabel}</button>
        </nav>
      )}
    </>
  );
}
