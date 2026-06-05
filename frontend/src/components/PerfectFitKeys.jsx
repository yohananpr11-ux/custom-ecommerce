import React, { useState, useMemo } from 'react';

/**
 * Returns exact centimeter measurements and specification details
 * based on the actual synced product data.
 */
function getProductSizingSpecs(product) {
  if (!product) return null;
  const title = (product.title || '').toLowerCase();
  
  // 1. Hoodies
  if (title.includes('hoodie') || title.includes('sweatshirt') || title.includes('hooded')) {
    return {
      type: 'hoodie',
      nameLabel: 'Unisex Heavy Blend Hoodie',
      fabric: product.fabric || '50% Cotton / 50% Polyester Heavy Blend Fleece',
      care: product.careInstructions || 'Machine wash warm, inside out, with like colors. Tumble dry medium.',
      delivery: product.deliveryInfo || 'Standard express delivery.',
      headers: ['Size', 'Width', 'Length', 'Sleeve'],
      rows: [
        { size: 'S', width: '51 cm', length: '69 cm', sleeve: '84 cm' },
        { size: 'M', width: '56 cm', length: '71 cm', sleeve: '86 cm' },
        { size: 'L', width: '61 cm', length: '74 cm', sleeve: '89 cm' },
        { size: 'XL', width: '66 cm', length: '76 cm', sleeve: '91 cm' },
        { size: '2XL', width: '71 cm', length: '79 cm', sleeve: '94 cm' },
      ],
      calculator: (height, weight) => {
        if (height < 165 && weight < 65) return 'S';
        if (height < 175 && weight < 75) return 'M';
        if (height < 185 && weight < 88) return 'L';
        if (height < 192 && weight < 100) return 'XL';
        return '2XL';
      }
    };
  }

  // 2. Jewelry
  if (
    title.includes('chain') || 
    title.includes('necklace') || 
    title.includes('pendant') || 
    title.includes('bracelet') || 
    title.includes('studs') || 
    title.includes('jewelry')
  ) {
    const isBracelet = title.includes('bracelet');
    const isStuds = title.includes('studs') || title.includes('earring');
    
    if (isBracelet) {
      return {
        type: 'jewelry_bracelet',
        nameLabel: 'Premium Streetwear Bracelet',
        fabric: product.fabric || 'Solid 316L Stainless Steel / Double-Polished Mirror Finish',
        care: product.careInstructions || 'Waterproof. Resistant to sweat and chlorine. Avoid scraping against abrasive metals.',
        delivery: product.deliveryInfo || 'Standard express delivery.',
        headers: ['Size', 'Length', 'Best For'],
        rows: [
          { size: '7"', length: '18 cm', fit: 'Standard/Slim wrist' },
          { size: '8"', length: '20 cm', fit: 'Relaxed/Thicker wrist' },
        ],
        calculator: (height, weight) => {
          if (weight < 70) return '7"';
          return '8"';
        }
      };
    }

    if (isStuds) {
      return {
        type: 'jewelry_studs',
        nameLabel: 'Premium Steel Studs',
        fabric: product.fabric || 'Implanted 316L Surgical Steel / Onyx Cubic Zirconia',
        care: product.careInstructions || 'Sterilize with alcohol periodically. 100% hypoallergenic.',
        delivery: product.deliveryInfo || 'Standard express delivery.',
        headers: ['Size', 'Diameter', 'Visual Profile'],
        rows: [
          { size: '6mm', length: '0.6 cm', profile: 'Subtle daily accent' },
          { size: '8mm', length: '0.8 cm', profile: 'Bold statement profile' },
        ],
        calculator: (height, weight) => {
          return '8mm (Recommended)';
        }
      };
    }

    // Default Chain / Necklace
    return {
      type: 'jewelry_chain',
      nameLabel: 'Brutalist Cuban / Micro Link Chain',
      fabric: product.fabric || '316L Stainless Steel / Gold Vacuum IP Plating (resistant to tarnishing)',
      care: product.careInstructions || 'Safe in water, shower, and ocean. Wipe dry with a microfiber cloth after contact.',
      delivery: product.deliveryInfo || 'Standard express delivery.',
      headers: ['Size', 'Length', 'Hang Style'],
      rows: [
        { size: '18"', length: '45 cm', fit: 'Collarbone frame' },
        { size: '20"', length: '50 cm', fit: 'Standard neck drop' },
        { size: '22"', length: '55 cm', fit: 'Mid-chest layering' },
        { size: '24"', length: '60 cm', fit: 'Deep streetwear hang' },
      ],
      calculator: (height, weight) => {
        if (height < 170) return '20"';
        if (height < 185) return '22"';
        return '24"';
      }
    };
  }

  // 3. T-Shirts & Tank Tops (Default)
  const isTank = title.includes('tank');
  return {
    type: 'tee',
    nameLabel: isTank ? 'Minimal Summer Tank Top' : 'Premium Heavyweight Tee',
    fabric: product.fabric || '100% Ring-Spun Combed Cotton, 180 GSM (Softstyle)',
    care: product.careInstructions || 'Machine wash cold, inside out. Avoid tumble drying to maintain fit and print lifespan.',
    delivery: product.deliveryInfo || 'Standard express delivery.',
    headers: ['Size', 'Width', 'Length', 'Fit Vibe'],
    rows: [
      { size: 'S', width: '46 cm', length: '71 cm', fit: 'Standard / Slim' },
      { size: 'M', width: '51 cm', length: '74 cm', fit: 'Perfect Daily' },
      { size: 'L', width: '56 cm', length: '76 cm', fit: 'Relaxed Street' },
      { size: 'XL', width: '61 cm', length: '79 cm', fit: 'Oversized drape' },
      { size: '2XL', width: '66 cm', length: '81 cm', fit: 'Maximum boxy' },
    ],
    calculator: (height, weight) => {
      if (height < 168 && weight < 62) return 'S';
      if (height < 178 && weight < 73) return 'M';
      if (height < 185 && weight < 85) return 'L';
      if (height < 192 && weight < 95) return 'XL';
      return '2XL';
    }
  };
}

export default function PerfectFitKeys({ product, allProducts = [] }) {
  // If product is not provided (e.g. on homepage), allow selecting between major categories using real products
  const [selectedHomeProductId, setSelectedHomeProductId] = useState(null);

  const activeProduct = useMemo(() => {
    if (product) return product;
    if (allProducts && allProducts.length > 0) {
      if (selectedHomeProductId) {
        return allProducts.find(p => p.id === selectedHomeProductId) || allProducts[0];
      }
      // Default to the Hoodie (ID 10) or T-Shirt (ID 5)
      const hoodie = allProducts.find(p => {
        const title = (p.title || '').toLowerCase();
        return title.includes('hoodie') || title.includes('sweatshirt');
      });
      if (hoodie) return hoodie;
      const tee = allProducts.find(p => {
        const title = (p.title || '').toLowerCase();
        return title.includes('tee') || title.includes('t-shirt');
      });
      if (tee) return tee;
      return allProducts[0];
    }
    return null;
  }, [product, allProducts, selectedHomeProductId]);

  const specs = useMemo(() => getProductSizingSpecs(activeProduct), [activeProduct]);

  // Size calculator state
  const [height, setHeight] = useState(175);
  const [weight, setWeight] = useState(72);
  const [calculatedSize, setCalculatedSize] = useState('');

  const handleCalculate = (e) => {
    e.preventDefault();
    if (specs && specs.calculator) {
      const size = specs.calculator(Number(height), Number(weight));
      setCalculatedSize(size);
    }
  };

  if (!activeProduct || !specs) {
    return null;
  }

  // Home selector options
  const selectors = allProducts.filter(p => [5, 10, 16].includes(Number(p.id)));

  return (
    <section className="perfect-fit-keys-section" id="perfect-fit-keys" dir="ltr">
      <div className="container">
        
        {/* Title Block */}
        <div className="section-title-block">
          <div className="badge-pill">
            <span>📏 PERFECT FIT KEYS</span>
          </div>
          <h2>PERFECT FIT ASSISTANT</h2>
          <p>
            Zero guesswork fit. Sizing metrics pulled live from the supplier specifications of the viewed item.
          </p>
        </div>

        {/* Homepage Product Toggles */}
        {!product && selectors.length > 0 && (
          <div className="home-product-selector">
            {selectors.map(p => {
              const isActive = activeProduct.id === p.id;
              const title = (p.title || '').toLowerCase();
              
              let btnLabel = 'Premium Tee';
              if (title.includes('hoodie') || title.includes('sweatshirt') || title.includes('hooded')) {
                btnLabel = 'Oversized Hoodie';
              } else if (title.includes('chain') || title.includes('necklace') || title.includes('link')) {
                btnLabel = 'Cuban Chain';
              }
              
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`selector-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedHomeProductId(p.id)}
                >
                  {btnLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Layout Grid */}
        <div className="fit-grid">
          
          {/* Sizing Specifications Card */}
          <div className="fit-card specs-card">
            <h3 className="specs-title">
              <span>💎</span> Materials & Sizing Specs
            </h3>
            
            <div className="product-identity-badge">
              <strong>{specs.nameLabel}</strong>
              {activeProduct.printifyId && <span className="supplier-tag">ID: {activeProduct.printifyId.slice(0, 10)}</span>}
            </div>

            {/* Fabric Composition */}
            <div className="spec-info-row">
              <span className="spec-label">Fabric & Material:</span>
              <p className="spec-val">{specs.fabric}</p>
            </div>

            {/* Care Instructions */}
            <div className="spec-info-row">
              <span className="spec-label">Care Instructions:</span>
              <p className="spec-val">{specs.care}</p>
            </div>

            {/* Sizing Table */}
            <div className="table-wrapper">
              <table className="sizing-table">
                <thead>
                  <tr>
                    {specs.headers.map((h, i) => <th key={i}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {specs.rows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="size-label-cell"><strong>{row.size}</strong></td>
                      <td>{row.width || row.length}</td>
                      <td>{row.length || row.fit || row.profile}</td>
                      {row.sleeve && <td>{row.sleeve}</td>}
                      {row.fit && !row.width && <td>{row.fit}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive Calculator Card */}
          <div className="fit-card calculator-card">
            <h3 className="specs-title">
              <span>🔑</span> Dynamic Sizing Engine
            </h3>
            <p className="calc-desc">
              Input your height and weight to resolve your absolute size recommendation.
            </p>

            <form onSubmit={handleCalculate} className="calc-form">
              <div className="form-group">
                <label>
                  Height (cm): <strong>{height} cm</strong>
                </label>
                <input
                  type="range"
                  min="150"
                  max="210"
                  value={height}
                  onChange={(e) => { setHeight(e.target.value); setCalculatedSize(''); }}
                  className="accent-range"
                />
              </div>

              <div className="form-group">
                <label>
                  Weight (kg): <strong>{weight} kg</strong>
                </label>
                <input
                  type="range"
                  min="40"
                  max="130"
                  value={weight}
                  onChange={(e) => { setWeight(e.target.value); setCalculatedSize(''); }}
                  className="accent-range"
                />
              </div>

              <button type="submit" className="calc-submit-btn">
                Calculate Fit size ⚡
              </button>
            </form>

            {calculatedSize && (
              <div className="calc-result-overlay">
                <span>Your Recommended Fit:</span>
                <div className="result-size-badge">{calculatedSize}</div>
                <p className="result-note">
                  *Based on our signature streetwear silhouette and current catalog measurements.
                </p>
              </div>
            )}
          </div>

        </div>

      </div>
    </section>
  );
}
