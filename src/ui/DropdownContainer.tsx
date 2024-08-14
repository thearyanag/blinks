import React, { useState, useRef, useEffect } from 'react';

export interface DropdownOption {
  name: string;
  description: string;
  verified: 'Yes' | 'No';
  act: string;
}

export interface DropdownOptionProps {
  option: DropdownOption;
  onSelect: (option: DropdownOption) => void;
}

export const DropdownOption: React.FC<DropdownOptionProps> = ({ option, onSelect }) => (
  <div 
    className="p-3 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors duration-200"
    onClick={() => onSelect(option)}
  >
    <div className="font-bold">Name: {option.name}</div>
    <div>Description: {option.description}</div>
    <div>Verified: {option.verified}</div>
    <div>Act: {option.act}</div>
  </div>
);

interface DropdownProps {
  options: DropdownOption[];
  onSelect?: (option: DropdownOption) => void;
}

export const Dropdown: React.FC<DropdownProps> = ({ options, onSelect }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSelect = (option: DropdownOption) => {
    console.log('Selected option:', option);
    if (onSelect) {
      onSelect(option);
    }
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    <div className="inline-flex items-center ml-2 relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full hover:bg-blue-50 transition-colors duration-200"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-gray-600">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {isOpen && (
        <div 
          className="absolute top-full left-0 mt-1 min-w-[200px] max-h-[300px] overflow-y-auto overflow-x-hidden bg-white border border-gray-200 rounded-md shadow-lg z-50"
          onWheel={handleScroll}
          onTouchMove={handleScroll}
        >
          {options.map((option, index) => (
            <DropdownOption key={index} option={option} onSelect={handleSelect} />
          ))}
        </div>
      )}
    </div>
  );
};
